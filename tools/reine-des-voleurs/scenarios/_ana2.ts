import { fightsOf, mergeStreams } from '../../fightlog/fusion'
import { rebuild } from '../../fightlog/rejeu'
import { streamsOf } from './apprendre'
const COL: Record<string, number> = { 'Java-Springboot': 327, Lamouit: 354, 'Lowkey-Jealous': 381, 'Kemist-Skyler': 408 }
const todo: Record<string, number[]> = { '2026-10-15/session-16-26-17': [13, 14, 21, 30, 32], '2026-10-14/session-17-12-41': [1, 7, 11, 12, 17, 18, 20, 22, 24, 25, 28] }
for (const [s, ks] of Object.entries(todo)) {
  const streams = streamsOf(`data/fightlogs/${s}.jsonl`)
  const prefer = ['Lowkey-Jealous', ...streams.map(x => x.name).filter(n => n !== 'Lowkey-Jealous')]
  const fights = fightsOf(streams)
  for (const k of ks) {
    const res = rebuild(mergeStreams(streams, prefer, fights[k - 1]).rows, { which: -1 }) as any
    const F = res.fighters, ev = res.replay.events
    const cell = new Map<number, number>(), alive = new Set<number>()
    for (const f of ev[0].fighters) { cell.set(f.id, f.cell); alive.add(f.id) }
    let round = 1, wave = 1, out = ''
    const deaths: string[] = []
    let lastDmg = new Map<number, string>()
    const endCell = new Map<number, number>(), moved = new Map<number, string[]>()
    let current: number | undefined
    for (const e of ev) {
      if (e.t === 'turnStart') current = e.fighter
      if (e.t === 'turnEnd' && F[e.fighter]?.kind === 'player') { endCell.set(e.fighter, cell.get(e.fighter)!); moved.set(e.fighter, []) }
      if ((e.t === 'teleport' || e.t === 'push') && F[e.target]?.kind === 'player' && current !== e.target && e.to >= 0) (moved.get(e.target) ?? moved.set(e.target, []).get(e.target)!).push(`${e.t === 'push' ? 'poussé' : 'déplacé'} ${e.from}→${e.to} au tour de ${(F[current!]?.name ?? '?').replace(/ -?\d+$/, '')}`)
      if (e.t === 'roundStart') round = e.round
      if (e.t === 'wave') wave = e.index
      if (e.t === 'move') cell.set(e.fighter, e.path[e.path.length - 1])
      if ((e.t === 'teleport' || e.t === 'push') && e.to >= 0) cell.set(e.target, e.to)
      if (e.t === 'damage' && F[e.target]?.kind === 'player') lastDmg.set(e.target, `${(F[e.source]?.name ?? '?').replace(/ -?\d+$/, '')}${e.kind === 'push' ? ' (poussée)' : ''} ${e.amount}`)
      if (e.t === 'death' && F[e.target]?.kind === 'player' && COL[F[e.target].name] !== undefined) {
        const n = F[e.target].name, c = cell.get(e.target)
        const fin = endCell.get(e.target)
        deaths.push(`${n.split('-')[0]} m${round} en ${c}${c === COL[n] ? '' : ' (hors colonne)'}, fin de son tour en ${fin}${fin === COL[n] ? ' (colonne)' : ' (HORS colonne)'}${(moved.get(e.target) ?? []).length ? ' puis ' + moved.get(e.target)!.join(', ') : ''} ← ${(F[e.killer]?.name ?? '?').replace(/ -?\d+$/, '')}`)
      }
    }
    console.log(`${s.slice(11)}#${k} (${res.rounds} manches) : ${deaths.slice(0, 1).join(' ; ')}`)
  }
}
