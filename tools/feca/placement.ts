// Placement des mules du Féca (personnages du groupe absents de JOUEURS) : en appât, groupées sur les cases
// que les Krobes frappent dès leur premier tour. Chaque mule en vie ajoute 2 000 PV à la Malamibe, et le Féca seul ne
// peut pas tuer des mules de 1 000 à 2 000 PV à temps : ce sont les monstres qui doivent les tuer en manche 1.
// Vidéo de référence (combat 1) : mules à 2 à 5 cases des monstres, toutes mortes vers 0:35, Malamibe de 16 001 à
// 2 001 PV. Combat perdu du 2026-10-17 à 20:07 : mules groupées à côté du Féca, à 11-12 cases des 3 monstres, jamais
// touchées, Malamibe à 12 001 PV, toute l'équipe tuée en manche 3.
import type { MapData } from '../../src/data/model'
import { distance } from '../../src/map/geometry'
import { zoneCells } from '../../src/map/zones'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { baseKrobe, isKrobe } from '../ventre-de-la-baleine/donjon'
import { threats } from '../ventre-de-la-baleine/menaces'
import { DANGER_FECA, SORT } from './feca'

type Zone = Parameters<typeof zoneCells>[0]

/** Zone de dommages de Stratus (carré de 3×3 dans les données). */
function zoneStratus(): Zone {
  const l = data.spell(SORT.stratus)?.levels.at(-1) as { effects?: { zone?: Zone }[] } | undefined
  return l?.effects?.find(e => e.zone)?.zone ?? ({ shape: 'G', size: 1 } as Zone)
}

/**
 * Ordre des cases de placement données aux mules, la première d'abord (hors cases des Fécas). Exposition d'une case :
 * dommages des Krobes qui peuvent la frapper à leur premier tour (menaces.ts, DANGER_FECA). Groupe : le carré de Stratus
 * dont les cases libres sont les plus exposées (puis les plus nombreuses, puis les plus proches des monstres) ; ses
 * cases d'abord, des plus exposées aux moins exposées, puis les autres de même. (Une mule à 5 cases ou moins d'une
 * Bacterrib la relance si elle vit encore à son tour : accepté, comme dans la vidéo.)
 */
export function ordreDesMules(map: MapData, monsters: { monsterId: number; cell: number }[], cells: number[], fecas: number[]): { ordre: number[]; centre: number; couvertes: number } {
  const free = cells.filter(c => !fecas.includes(c))
  if (!free.length) return { ordre: [], centre: -1, couvertes: 0 }
  const krobes = monsters.filter(m => isKrobe(m.monsterId))
  const t = threats(map, krobes.map(m => ({ monsterId: m.monsterId, cell: m.cell })), [])
  const exposure = new Map(free.map(c => {
    let e = 0
    for (const src of t.sources.get(c) ?? []) {
      const m = krobes.find(k => k.cell === src)
      if (m) e += DANGER_FECA[baseKrobe(m.monsterId)] ?? 600
    }
    return [c, e] as [number, number]
  }))
  const near = (c: number) => (monsters.length ? Math.min(...monsters.map(m => distance(m.cell, c))) : 0)
  const zone = zoneStratus()
  // (zone symétrique : les centres qui couvrent une case sont les cases de sa propre zone)
  const centres = new Set<number>()
  for (const c of free) for (const z of zoneCells(zone, c, c)) if (map.cells[z]?.walkable) centres.add(z)
  let best: { centre: number; e: number; n: number; d: number } | undefined
  for (const centre of centres) {
    const inZone = new Set(zoneCells(zone, centre, centre))
    const covered = free.filter(c => inZone.has(c))
    const e = covered.reduce((s, c) => s + (exposure.get(c) ?? 0), 0)
    const d = covered.reduce((s, c) => s + near(c), 0) / Math.max(1, covered.length)
    // (exposition, puis au plus près des monstres, puis le plus de cases : 2026-10-17 à 23:43, aucune case exposée, le
    // plus grand groupe était le plus loin des monstres)
    if (!best || e > best.e || (e === best.e && (d < best.d || (d === best.d && covered.length > best.n)))) {
      best = { centre, e, n: covered.length, d }
    }
  }
  const centre = best!.centre
  const inZone = new Set(zoneCells(zone, centre, centre))
  const ordre = [...free].sort((a, b) => Number(inZone.has(b)) - Number(inZone.has(a)) ||
    (exposure.get(b) ?? 0) - (exposure.get(a) ?? 0) || near(a) - near(b) || a - b)
  return { ordre, centre, couvertes: best!.n }
}

/**
 * Case d'une tueuse (TUEUSES) : à 3 à 6 cases du centre du groupe des mules (portée de ses sorts de zone, Œil de Taupe à
 * 3-7), hors du groupe ; la plus proche du centre, puis la plus loin des monstres. Sinon : la prochaine case des mules.
 */
export function caseTueuse(monsters: { monsterId: number; cell: number }[], cells: number[], prises: Set<number>, centre: number, groupe: number[]): number | undefined {
  const near = (c: number) => (monsters.length ? Math.min(...monsters.map(m => distance(m.cell, c))) : 0)
  const libres = cells.filter(c => !prises.has(c))
  const loin = libres.filter(c => !groupe.includes(c) && distance(c, centre) >= 3 && distance(c, centre) <= 6)
    .sort((a, b) => distance(a, centre) - distance(b, centre) || near(b) - near(a) || a - b)
  return loin[0] ?? libres.find(c => !groupe.includes(c)) ?? libres[0]
}
