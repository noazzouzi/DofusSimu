// Relecture : dégâts REÇUS par un Crâ (caractéristiques du joueur, 3 342 PV) pour chaque sort offensif des monstres du
// combat, mesurés dans le moteur (jet moyen, critique pondéré), lanceur à la distance minimale utile, en ligne.
// Fenêtre : du lancer au début du tour suivant du monstre (poisons et effets différés de 1 tour compris).
import { createEngine } from '../../../../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../../../../src/engine/factory'
import { castSpell } from '../../../../src/engine/cast'
import { pointToCell } from '../../../../src/map/geometry'
import type { MapData } from '../../../../src/data/model'
import type { Fighter, FightState } from '../../../../src/engine/types'
import { data, CRA, CRA_HP, ALL_SPELLS } from '../damage/lib'
const openMap = (): MapData => ({ id: 0, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }) as unknown as MapData
const MONSTERS = [
  { id: 3726, grade: 1, name: 'Reine (g1)' }, { id: 3746, grade: 5, name: 'Mâchassin' }, { id: 3747, grade: 5, name: 'Terristocrate' },
  { id: 3748, grade: 5, name: 'Doublure' }, { id: 3749, grade: 5, name: 'Bourôliste' }, { id: 3750, grade: 5, name: 'Magouille' },
]
function untilTurnOf(engine: ReturnType<typeof createEngine>, fight: FightState, f: Fighter) {
  for (let i = 0; i < 50; i++) {
    const cur = engine.current(fight)
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    const nx = engine.nextTurn(fight)
    if (!nx || nx.id === f.id) return
  }
}
for (const M of MONSTERS) {
  const mon = data.monster(M.id)!
  const parts: string[] = []
  for (const sid of mon.spells) {
    const lvl = data.spellLevel(sid, { grade: M.grade } as never) ?? data.spellLevel(sid, {} as never)
    if (!lvl) continue
    let best = -1, bestD = 0, why = ''
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const engine = createEngine(data)
      const mcell = pointToCell(16, 0), ccell = pointToCell(16, d)
      const m = createMonsterFighter(data, { monsterId: M.id, grade: M.grade, team: 1, cell: mcell })
      m.baseStats.initiative = m.stats.initiative = 9999
      const c = createPlayerFighter(data, { name: 'Crâ', breedId: 9, level: 200, stats: { ...CRA }, maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: ccell })
      c.baseStats.initiative = c.stats.initiative = 1
      const fight = engine.createFight({ map: openMap(), fighters: [m, c], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 99 } as never })
      const mm = fight.fighters.find(f => f.team === 1)!, cc = fight.fighters.find(f => f.team === 0)!
      cc.hp = cc.maxHp = cc.baseMaxHp = 1_000_000
      untilTurnOf(engine, fight, mm)
      mm.ap = 99
      const n0 = fight.events.length
      let r = castSpell(engine, fight, mm, sid, cc.cell)
      if (!r.ok) r = castSpell(engine, fight, mm, sid, mm.cell)
      if (!r.ok) r = castSpell(engine, fight, mm, sid, pointToCell(16, d - 1))
      if (!r.ok) { why = String(r.failure); continue }
      untilTurnOf(engine, fight, cc); untilTurnOf(engine, fight, mm)
      let dmg = 0
      for (const e of fight.events.slice(n0) as { t: string; target?: number; amount?: number }[]) if (e.t === 'damage' && e.target === cc.id) dmg += e.amount ?? 0
      if (dmg > best) { best = dmg; bestD = d }
      break
    }
    parts.push(best >= 0 ? `${data.spell(sid)?.name} ${best} (à ${bestD}, ${Math.round(100 * best / CRA_HP)} % des PV)` : `${data.spell(sid)?.name} : non lancé (${why})`)
  }
  console.log(`${M.name.padEnd(14)} ${parts.join(' ; ')}`)
}
