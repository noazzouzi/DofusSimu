// Étalonnage : rejoue dans le moteur les tours réels du journal (déplacements et lancers dans leur ordre, mêmes cases)
// et compare les dégâts prévus (jet moyen, critique pondéré) aux dégâts réels, cible par cible. Relève aussi, pour
// chaque lancer refusé pour la portée, la PO qu'il aurait fallu.
//   npx tsx tools/reine-des-voleurs/planificateur/etalonnage.ts
import { castSpell, spellRange } from '../../../src/engine/cast'
import { move } from '../../../src/engine/move'
import { distance } from '../../../src/map/geometry'
import { buildFight, data } from './etat'
import { readStream, snapshotAt, type Row } from './journal'

export const FILES = ['session-10-16-34.jsonl', 'session-10-35-50.jsonl'].map(f => `data/fightlogs/2026-10-09/${f}`)
export const NAMES: Record<number, string> = { 900266590501: 'Kemist', 900265148709: 'Java', 900264689957: 'Lowkey', 900264624421: 'Lamouit' }
/** Sorts du journal à ne pas rejouer : Péché Mignon (bombe de la Reine), Bleu Turquoise (sort d'objet déclenché),
 *  32558 (sous-sort de Tirs Éloignés, lancé par lui). */
const SKIP = new Set([4693, 4692, 4691, 5952, 32558, 32998])

const nameOf = (id: number) => data.spell(id)?.name ?? `sort ${id}`

export function replayTurn(rows: Row[], round: number, player: number) {
  const { snap, actual } = snapshotAt(rows, round, player, NAMES)
  const b = buildFight(snap)
  const me = b.byGameId.get(player)!
  const n0 = b.fight.events.length
  const steps: string[] = []
  const rangeNeeds: { spell: number; dist: number; max: number }[] = []
  for (const st of actual.steps) {
    if (st.kind === 'move') {
      if (st.path[0] !== me.cell) steps.push(`(chemin depuis ${st.path[0]}, Crâ en ${me.cell})`)
      move(b.fight, me, st.path[0] === me.cell ? st.path : [me.cell, ...st.path.slice(1)], b.engine)
      steps.push(`→${me.cell}`)
      continue
    }
    if (SKIP.has(st.spell)) continue
    const from = me.cell
    const r = castSpell(b.engine, b.fight, me, st.spell, st.cell)
    const known = me.spells.find(s => s.spellId === st.spell)
    const dist = distance(from, st.cell)
    if (!r.ok && r.failure === 'range' && known) rangeNeeds.push({ spell: st.spell, dist, max: spellRange(me, known.level).max })
    steps.push(`${nameOf(st.spell)}@${st.cell}(PO ${dist})${r.ok ? '' : ` REFUS ${r.failure}`}`)
  }
  const predicted = new Map<number, number>()
  for (const e of b.fight.events.slice(n0) as { t: string; target?: number; amount?: number }[]) {
    if (e.t !== 'damage' || e.target === undefined) continue
    const gid = b.gameIdOf.get(e.target)!
    predicted.set(gid, (predicted.get(gid) ?? 0) + (e.amount ?? 0))
  }
  const real = new Map<number, number>()
  for (const d of actual.damage) real.set(d.target, (real.get(d.target) ?? 0) + d.amount)
  return { snap, steps, predicted, real, rangeNeeds }
}

if (process.argv[1].endsWith('etalonnage.ts')) {
  const rows = readStream(FILES, 900266590501)
  const turns: [number, number][] = [[1, 900265148709], [1, 900264624421], [1, 900264689957], [1, 900266590501], [2, 900265148709], [2, 900264624421], [2, 900264689957], [2, 900266590501]]
  let sumP = 0
  let sumR = 0
  for (const [round, p] of turns) {
    const r = replayTurn(rows, round, p)
    const ids = new Set([...r.predicted.keys(), ...r.real.keys()])
    const name = (gid: number) => r.snap.entities.find(e => e.gameId === gid)?.name ?? String(gid)
    console.log(`\nManche ${round}, ${NAMES[p]} : ${r.steps.join(' ; ')}`)
    for (const n of r.rangeNeeds) console.log(`  portée : ${nameOf(n.spell)} à ${n.dist} cases, portée moteur ${n.max} (+${n.dist - n.max} PO manquantes)`)
    for (const gid of ids) {
      const pr = Math.round(r.predicted.get(gid) ?? 0)
      const re = r.real.get(gid) ?? 0
      if (gid > 0 && !pr && !re) continue
      console.log(`  ${name(gid).padEnd(22)} prévu ${String(pr).padStart(5)}  réel ${String(re).padStart(5)}  ${re ? `(${Math.round((100 * pr) / re)} %)` : ''}`)
      if (gid < 0) {
        sumP += pr
        sumR += re
      }
    }
  }
  console.log(`\nTotal monstres : prévu ${Math.round(sumP)}, réel ${sumR} (${Math.round((100 * sumP) / sumR)} %)`)
}
