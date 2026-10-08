// Trace : placement proposé sous la règle du moteur actuel (explosion à la fin du même tour), ordre 354→381→451→380.
import { loadMap, simulate, xy, type SimState } from './modele-bombes'
import { pointToCell as P } from '/home/user/DofusSimu/src/map/geometry'
const map = loadMap()
const ord = [354, 381, 451, 380]
const dest = new Map([[354, 354], [381, 381], [380, P(17, -12)], [451, P(17, -14)]])
const r = simulate(map, ord, { rounds: 2, timing: 'same', log: true, move: (rd: number, i: number, st: SimState) => (rd === 1 ? dest.get(ord[i]) : undefined) })
for (const e of r.events) console.log(`m${e.round} J${e.turn + 1} ${e.kind} J${e.who + 1} ${xy(e.cell)} ${e.info ?? ''}`)
