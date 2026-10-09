import { createEngine } from '../../../../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../../../../src/engine/factory'
import { pointToCell } from '../../../../src/map/geometry'
import { ALL_SPELLS, CRA, CRA_HP, data } from './lib'
const engine = createEngine(data)
const cras = [0, 1, 2, 3].map(k => { const f = createPlayerFighter(data, { name: `Crâ${k + 1}`, breedId: 9, level: 200, stats: { ...CRA }, maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: pointToCell(16 + k, -5) }); f.baseStats.initiative = f.stats.initiative = 9000 - k; return f })
const m0 = createMonsterFighter(data, { monsterId: 3749, grade: 5, team: 1, cell: pointToCell(16, 0) }); m0.baseStats.initiative = m0.stats.initiative = 99999
const fight = engine.createFight({ map: { id: 0, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 })) } as never, fighters: [...cras, m0], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 99 } as never })
const seq: string[] = []
for (let i = 0; i < 12; i++) { const cur = engine.current(fight); if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur); const nx = engine.nextTurn(fight); seq.push(`${nx?.name}@r${fight.round}`) }
console.log(seq.join(' '))
