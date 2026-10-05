import { describe, expect, it } from 'vitest'
import { emptyStats } from '../src/core/types'
import type { MapData } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import { createEngine } from '../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'

const data = loadDataStore('data')
const openMap: MapData = {
  id: 0,
  cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })),
}

function stats() {
  const s = emptyStats()
  Object.assign(s, { ap: 11, mp: 6, strength: 600, critical: 40, initiative: 2000 })
  return s
}

describe("sorts passifs d'équipement (effet 1175)", () => {
  it('Dofus Turquoise (5952) et Vulbis (8396) : leurs sorts sont lancés sur le porteur au début du combat', () => {
    const engine = createEngine(data)
    const p = createPlayerFighter(data, { name: 'Porteur', breedId: 8, level: 200, stats: stats(), maxHp: 4000, passiveSpells: [5952, 8396], cell: 300 })
    const m = createMonsterFighter(data, { monsterId: 3834, grade: 5, team: 1, cell: 330 })
    const fight = engine.createFight({ map: openMap, fighters: [p, m], options: { seed: 1, record: true } })
    const porteur = fight.fighters[0]
    const spellIds = new Set(porteur.buffs.map(b => b.spellId))
    // Chaque sort passif laisse au moins un buff (déclencheur ou modificateur) sur son porteur.
    expect(porteur.buffs.length).toBeGreaterThan(0)
    expect([...spellIds].some(id => id === 5952 || id === 8396 || data.spell(id) !== undefined)).toBe(true)
    expect(fight.unknownEffects ?? 0).toBe(0)
  })

  it('sans passifs : aucun buff au début du combat', () => {
    const engine = createEngine(data)
    const p = createPlayerFighter(data, { name: 'Nu', breedId: 8, level: 200, stats: stats(), maxHp: 4000, cell: 300 })
    const m = createMonsterFighter(data, { monsterId: 3834, grade: 5, team: 1, cell: 330 })
    const fight = engine.createFight({ map: openMap, fighters: [p, m], options: { seed: 1 } })
    expect(fight.fighters[0].buffs.length).toBe(0)
  })
})
