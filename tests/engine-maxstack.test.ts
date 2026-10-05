import { describe, expect, it } from 'vitest'
import type { MapData } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import { castSpell } from '../src/engine/cast'
import { createEngine } from '../src/engine/index'
import { createMonsterFighter } from '../src/engine/factory'

const data = loadDataStore('data')
const openMap: MapData = {
  id: 0,
  cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })),
}

describe('maxStack des buffs déclencheurs (noyau)', () => {
  it('Bouclier absorbant (Buboxor, 5026, maxStack 3) : au plus 3 cumuls de chaque déclencheur DR', () => {
    const engine = createEngine(data)
    const bub = createMonsterFighter(data, { monsterId: 3838, grade: 5, team: 1, cell: 300 })
    const dummy = createMonsterFighter(data, { monsterId: 3834, grade: 5, team: 0, cell: 400 })
    const fight = engine.createFight({ map: openMap, fighters: [bub, dummy], options: { seed: 1 } })
    const b = fight.fighters[0]
    for (let i = 0; i < 6; i++) {
      b.ap = 50
      b.castsThisTurn = {}
      b.cooldowns = {}
      const res = castSpell(engine, fight, b, 5026, b.cell)
      expect(res.ok).toBe(true)
    }
    const listeners = b.buffs.filter(x => x.spellId === 5026 && x.kind === 'trigger')
    const byEffect = new Map<number, number>()
    for (const x of listeners) byEffect.set(x.effect.effectId, (byEffect.get(x.effect.effectId) ?? 0) + 1)
    expect(byEffect.get(138)).toBe(3)
    expect(byEffect.get(128)).toBe(3)
  })
})
