// Trace moteur : Flèche Dévorante ×2 par tour (et ×1 par tour) sur le Bourôliste — mécanique des paliers.
import { createEngine } from '../../../../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../../../../src/engine/factory'
import { castSpell } from '../../../../src/engine/cast'
import { pointToCell } from '../../../../src/map/geometry'
import { ALL_SPELLS, CRA, CRA_HP, data } from './lib'
for (const per of [1, 2]) {
  const engine = createEngine(data)
  const cells = Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const }))
  const c0 = createPlayerFighter(data, { name: 'Crâ', breedId: 9, level: 200, stats: { ...CRA }, maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: pointToCell(16, -4) })
  c0.baseStats.initiative = c0.stats.initiative = 9999
  const m0 = createMonsterFighter(data, { monsterId: 3749, grade: 5, team: 1, cell: pointToCell(16, 0) })
  const fight = engine.createFight({ map: { id: 0, cells } as never, fighters: [c0, m0], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 99 } as never })
  const c = fight.fighters[0], m = fight.fighters[1]
  m.hp = m.maxHp = 1e7
  console.log(`--- ${per} Dévorante(s) par tour`)
  for (let turn = 1; turn <= 6; turn++) {
    for (let i = 0; i < 50; i++) { const cur = engine.current(fight); if (cur && fight.round > 0) engine.endTurn(fight, cur); const nx = engine.nextTurn(fight); if (!nx || nx.id === c.id) break }
    const n0 = fight.events.length
    for (let k = 0; k < per; k++) { c.ap = 99; castSpell(engine, fight, c, 32446, m.cell) }
    const evs = fight.events.slice(n0) as { t: string; target?: number; amount?: number; stateId?: number; added?: boolean; name?: string }[]
    console.log(`  tour ${turn} : ${evs.filter(e => e.t === 'damage' || e.t === 'state').map(e => e.t === 'damage' ? `dmg ${e.amount}` : `${e.added ? '+' : '−'}${e.name}`).join(', ')} | états cible [${m.states}]`)
  }
}
