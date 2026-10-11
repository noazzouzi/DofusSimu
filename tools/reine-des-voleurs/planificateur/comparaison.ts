// Comparaison, tour par tour, entre ce que les Crâs ont joué (journal) et le meilleur tour sûr du planificateur.
//   npx tsx tools/reine-des-voleurs/planificateur/comparaison.ts
import { castSpell } from '../../../src/engine/cast'
import { move } from '../../../src/engine/move'
import { simulateHorizon } from './bombes'
import { buildFight, data } from './etat'
import { FILES, NAMES } from './etalonnage'
import { readStream, snapshotAt } from './journal'
import { threatsOn } from './menaces'
import { bombWorld, planTurn } from './recherche'

const SKIP = new Set([4693, 4692, 4691, 5952, 32558, 32998])
const rows = readStream(FILES, 900266590501)
const turns: [number, number][] = [[1, 900265148709], [1, 900264624421], [1, 900264689957], [1, 900266590501], [2, 900265148709], [2, 900264624421], [2, 900264689957], [2, 900266590501]]
const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`

let sumReal = 0
let sumBest = 0
for (const [round, p] of turns) {
  const { snap, actual } = snapshotAt(rows, round, p, NAMES)
  // Ce qui a été joué, rejoué dans le moteur, et la sécurité de la case finale.
  const b = buildFight(snap)
  const me = b.byGameId.get(p)!
  for (const st of actual.steps) {
    if (st.kind === 'move') move(b.fight, me, st.path[0] === me.cell ? st.path : [me.cell, ...st.path.slice(1)], b.engine)
    else if (!SKIP.has(st.spell)) castSpell(b.engine, b.fight, me, st.spell, st.cell)
  }
  const threats = threatsOn(b.engine, b.fight, me, me.cell)
  const deaths = simulateHorizon(bombWorld(b, b.fight, snap), p, round).deaths.filter(d => d.atActiveEnd || d.id === p)
  const real = actual.damage.reduce((s, d) => s + d.amount, 0)
  const realPool = actual.damage.filter(d => d.target !== -17 || !actual.damage.some(x => x.target === -16)).reduce((s, d) => s + d.amount, 0)
  // Meilleur tour sûr.
  const res = planTurn(snap, { top: 1 })
  const best = res.plans[0]
  sumReal += realPool
  sumBest += best?.total ?? 0
  const verdict = threats.length || deaths.length
    ? `NON SÛR (${[...threats.slice(0, 1).map(t => `${b.fight.fighters[t.monster].name} via ${spellName(t.spell)}`), ...deaths.map(d => `${NAMES[d.id] ?? d.id} tué par bombe`)].join(', ')})`
    : 'sûr'
  console.log(`\nManche ${round}, ${NAMES[p]}`)
  console.log(`  joué  : ${String(realPool).padStart(5)} dégâts (${real} avec les deux Doublures), fin en ${me.cell} : ${verdict}`)
  console.log(`  mieux : ${String(Math.round(best?.total ?? 0)).padStart(5)} dégâts, fin en ${best?.endCell} — ${best ? best.steps.map(s => (s.kind === 'move' ? `→${s.path.at(-1)}` : spellName(s.spell))).join(', ') : 'aucun tour sûr'}`)
}
console.log(`\nTotal (Doublure et copie comptées une fois) : joué ${sumReal}, meilleur tour sûr ${Math.round(sumBest)} (×${(sumBest / sumReal).toFixed(2)})`)
