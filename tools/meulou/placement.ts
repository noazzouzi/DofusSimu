// Placement de la Tanière du Meulou : la case du Sacrieur et celles des mules, parmi les cases de placement du groupe.
//  - Sacrieur : au plus près des monstres. Il joue le plus souvent en 2e (après un Cocholou ou un Mergranlou) : collé à
//    eux, son 1er tour est déjà un Bain de Sang ou une Décimation sur plusieurs monstres (2026-10-19, salles 4 et 5 :
//    2 monstres touchés dès la manche 1).
//  - Mules : dans la salle du boss, le plus loin possible du Meulou (il joue le premier, 7 PM : la première mule qu'il
//    tue devient un Mulou de 1 800 PV, vu le 2026-10-19) ; ailleurs, au plus près du Sacrieur, pour que les Cocholous et
//    les Mergranlous, qui visent d'abord les mules, se rapprochent de lui [R].
import type { MapData } from '../../src/data/model'
import { distance, inLine } from '../../src/map/geometry'
import { AU_CONTACT, MEULOU } from './meulou'

export interface MonstrePlace {
  monsterId: number
  cell: number
}

/** Case du Sacrieur : monstres au contact (×10), à portée d'un Ravage (en ligne, 2-6 cases : ×3), puis la plus proche d'eux. */
export function caseSacrieur(map: MapData, monsters: MonstrePlace[], cells: number[]): { cell: number | undefined; note: string } {
  const walk = (c: number) => !!map.cells[c]?.walkable
  let best: { cell: number; v: number } | undefined
  for (const c of cells) {
    if (!walk(c)) continue
    let v = 0
    for (const m of monsters) {
      const d = distance(c, m.cell)
      if (d === 1) v += 10
      else if (d <= 6 && inLine(c, m.cell)) v += 3
      // (les monstres de contact viendront à lui : leur distance compte moins)
      v -= (AU_CONTACT.has(m.monsterId) ? 0.5 : 1) * d * 0.2
    }
    if (!best || v > best.v) best = { cell: c, v }
  }
  if (!best) return { cell: undefined, note: 'aucune case de placement praticable' }
  const near = monsters.filter(m => distance(best!.cell, m.cell) === 1).length
  const closest = Math.min(...monsters.map(m => distance(best!.cell, m.cell)))
  return { cell: best.cell, note: `Sacrieur en ${best.cell} : ${near} monstre(s) au contact, le plus proche à ${closest} case(s)` }
}

/** Ordre des cases des mules (la première libre est prise) : loin du Meulou s'il est là, sinon près du Sacrieur. */
export function ordreDesMules(monsters: MonstrePlace[], cells: number[], sacri: number | undefined): { ordre: number[]; note: string } {
  const meulou = monsters.find(m => m.monsterId === MEULOU)
  const free = cells.filter(c => c !== sacri)
  if (meulou) {
    return { ordre: [...free].sort((a, b) => distance(b, meulou.cell) - distance(a, meulou.cell)), note: `mules loin du Meulou (${meulou.cell})` }
  }
  if (sacri === undefined) return { ordre: free, note: 'mules : cases du jeu (Sacrieur sans case)' }
  return { ordre: [...free].sort((a, b) => distance(a, sacri) - distance(b, sacri)), note: `mules près du Sacrieur (${sacri})` }
}
