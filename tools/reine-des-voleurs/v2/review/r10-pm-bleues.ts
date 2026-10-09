// Relecture : PM depuis la case bleue la plus proche (Crâs sur leurs cases tenues = obstacles) pour les cases interdites.
import { loadMap } from '../search/modele2'
import { bfsDistances } from '../../../../src/map/path'
const map = loadMap()
const occ = new Set([311, 392, 398, 479])
const cells = [283, 370, 364, 451, 255, 342, 336, 423, 269, 356, 350, 437, 325, 412, 406, 493, 284, 371, 365, 452]
const out = cells.map(c => { let m = 99; for (const b of map.blue) { const d = bfsDistances(b, x => !!map.walk[x] && (!occ.has(x) || x === c), 80)[c]; if (d >= 0) m = Math.min(m, d) } return `${c}:${m}` })
console.log(out.join(' '))
