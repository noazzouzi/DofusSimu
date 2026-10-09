// Interactions entre Crâs : un même plan joué seul (bench) et par 4 Crâs (teamBench), sort par sort.
import { TARGETS, offLine, bench, nameOf, fmt } from './lib'
import { teamBench } from './teambench'
const t = TARGETS[1]
const S = { TP: 32466, JUG: 32460, REC: 32426, CIN: 32427, TYR: 32448, DEV: 32446, DET: 32444, PERS: 32433, PLU: 32431, BOO: 32432 }
const plans: [string, { spell: number; on?: 'self' }[][]][] = [
  ['Jugement seul', [[{ spell: S.JUG }]]],
  ['Tyrannique ×1', [[{ spell: S.TYR }]]],
  ['Tyrannique ×2', [[{ spell: S.TYR }, { spell: S.TYR }]]],
  ['Cinglante ×2', [[{ spell: S.CIN }, { spell: S.CIN }]]],
  ['Recul ×2', [[{ spell: S.REC }, { spell: S.REC }]]],
  ['TP + Jugement', [[{ spell: S.TP, on: 'self' }, { spell: S.JUG }], [{ spell: S.JUG }]]],
  ['Dévorante ×1', [[{ spell: S.DEV }]]],
  ['Détonante ×2', [[{ spell: S.DET }, { spell: S.DET }]]],
  ['Pluie ×1', [[{ spell: S.PLU }]]],
  ['Boomerang ×1', [[{ spell: S.BOO }]]],
  ['A/B Mâchassin', [[{ spell: S.TP, on: 'self' }, { spell: S.JUG }, { spell: S.REC }, { spell: S.CIN }, { spell: S.CIN }], [{ spell: S.JUG }, { spell: S.TYR }, { spell: S.CIN }, { spell: S.CIN }]]],
]
for (const [name, cyc] of plans) {
  const one = bench(cyc, t, offLine(5), { turns: 12, warm: 4 })
  const team = teamBench((_k, r) => cyc[(r - 1) % cyc.length], t, false, { rounds: 12, warm: 4 })
  console.log(`${name.padEnd(16)} seul ${fmt(one.mean).padStart(6)} | 4 Crâs ${fmt(team.mean).padStart(7)} = ${(team.mean / one.mean / 4 * 100).toFixed(1)} % de 4× (par Crâ ${team.byCra.map(x => fmt(x)).join('/')})${team.refused.size ? ' refus ' + JSON.stringify([...team.refused]) : ''}`)
}
void nameOf
