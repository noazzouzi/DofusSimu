// Fidélité de l'IA des monstres : pour chaque tour de monstre du journal, l'état réel au début de son tour est rejoué
// par le cerveau des monstres du moteur (src/ai/monster), et ses actions sont comparées à celles du vrai monstre.
//   npx tsx tools/reine-des-voleurs/planificateur/ia-monstres.ts
import { monsterControllers } from './monstres'
import type { FightEvent } from '../../../src/engine/types'
import { distance } from '../../../src/map/geometry'
import { buildFight, data, type Snapshot } from './etat'
import { PROTO, snapshotAt, type Row, type TurnRecord } from './journal'
import { journalFiles, loadJournal } from './web'

export interface MonsterTurnCheck {
  round: number
  id: number
  name: string
  real: string[]
  sim: string[]
  realEnd?: number
  simEnd: number
}

const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`

/** Tous les débuts de tour (manche, combattant) d'un flux, bombes comprises. */
export function allTurns(rows: Row[]): { round: number; id: number }[] {
  const out: { round: number; id: number }[] = []
  let round = 0
  for (const r of rows) {
    if (r.k !== 'm') continue
    if (r.n === PROTO.round) round = r.d.fxjj
    else if (r.n === PROTO.turnStart) out.push({ round, id: r.d.fxjr })
  }
  return out
}

function describeReal(a: TurnRecord, snap: Snapshot): string[] {
  const at = (cell: number) => snap.entities.find(e => e.cell === cell)?.name
  return a.steps.map(s => (s.kind === 'move' ? `→${s.path.at(-1)}` : `${spellName(s.spell)}@${s.cell}${at(s.cell) ? ` (${at(s.cell)})` : ''}`))
}

/** Rejoue le tour du monstre `id` (manche `round`) depuis l'état réel, avec le cerveau des monstres. */
export function simulateMonsterTurn(snap: Snapshot, seed = 1): { events: FightEvent[]; endCell: number; steps: string[] } {
  const b = buildFight(snap)
  const { engine, fight } = b
  const m = b.byGameId.get(snap.active)!
  // Ordre de jeu : celui du journal (identifiants moteur), bombes après leur poseur.
  const order: number[] = []
  for (const gid of snap.order) {
    const f = b.byGameId.get(gid)
    if (!f) continue
    order.push(f.id)
    for (const e of snap.entities) if (e.kind === 'bomb' && e.owner === gid) order.push(b.byGameId.get(e.gameId)!.id)
  }
  fight.timeline = order
  fight.turnIndex = Math.max(0, order.indexOf(m.id))
  const n0 = fight.events.length
  engine.startTurn(fight, m)
  monsterControllers(seed)(m).playTurn(engine, fight, m)
  const events = fight.events.slice(n0)
  const name = (id: number) => fight.fighters[id]?.name ?? String(id)
  const steps: string[] = []
  for (const e of events) {
    if (e.t === 'move' && e.fighter === m.id) steps.push(`→${e.path.at(-1)}`)
    if (e.t === 'cast' && e.fighter === m.id) {
      const occ = b.snap.entities.find(x => x.cell === e.cell)
      steps.push(`${spellName(e.spellId)}@${e.cell}${occ ? ` (${occ.name})` : ''}`)
    }
  }
  void name
  return { events, endCell: m.cell, steps }
}

if (process.argv[1].endsWith('ia-monstres.ts')) {
  const j = loadJournal()
  if (!j) throw new Error('journal vide')
  const rows = j.rows.rows
  const turns = allTurns(rows).filter(t => t.id < 0)
  const seen = new Set<string>()
  const gaps: number[] = []
  const nearGaps: number[] = []
  for (const t of turns) {
    const key = `${t.round}:${t.id}`
    if (seen.has(key)) continue
    seen.add(key)
    let r
    try {
      r = snapshotAt(rows, t.round, t.id, j.names)
    } catch {
      continue
    }
    const me = r.snap.entities.find(e => e.gameId === t.id)
    if (!me || me.kind === 'bomb') continue
    const sim = simulateMonsterTurn(r.snap)
    const realEnd = r.actual.moves.at(-1)?.at(-1) ?? me.cell
    console.log(`\nManche ${t.round}, ${me.name} (case ${me.cell})`)
    console.log(`  réel : ${describeReal(r.actual, r.snap).join(' ; ') || '(rien)'} — fin ${realEnd}`)
    const cras = r.snap.entities.filter(e => e.kind === 'cra').map(e => e.cell)
    const near = (c: number) => Math.min(...cras.map(x => distance(c, x)))
    gaps.push(distance(realEnd, sim.endCell))
    nearGaps.push(Math.abs(near(realEnd) - near(sim.endCell)))
    console.log(`  IA   : ${sim.steps.join(' ; ') || '(rien)'} — fin ${sim.endCell}`)
    console.log(`  écart : ${distance(realEnd, sim.endCell)} case(s) ; Crâ le plus proche à ${near(realEnd)} (réel) / ${near(sim.endCell)} (IA)`)
  }
  const mean = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
  console.log(`
Bilan sur ${gaps.length} tours de monstre : écart moyen de la case de fin ${mean(gaps)} case(s), écart moyen de distance au Crâ le plus proche ${mean(nearGaps)}`)
  void journalFiles
}
