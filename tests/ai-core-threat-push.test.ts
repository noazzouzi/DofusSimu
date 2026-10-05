/**
 * Menace de poussée (réglage, tour 4) : les dommages de collision d'un sort de poussée (Mise en situation du Brabuzar :
 * +200 dommages de poussée puis poussée de 4) entrent dans la menace de l'ennemi, selon l'obstacle derrière la cible.
 * Sans eux, la menace prévue d'un Brabuzar valait ≈ 1/10 des dégâts réellement subis (poussées ≈ 9 100 par combat).
 */
import { describe, expect, it } from 'vitest'
import { createPerception, createView } from '../src/ai/core'
import { cellInDirection } from '../src/map/geometry'
import { BREEDS, engineFor, makeFight, mapOf, monster, player, VORTEX_MAP } from './ai-core-helpers'

const BRABUZAR = 3839

/** Case X (et direction d) : X − d, X − 2d marchables ; derrière X (X + d) : mur si `wall`, sinon 4 cases libres. */
function findLine(wall: boolean): { x: number; d: number } {
  const map = mapOf(VORTEX_MAP)
  const ok = (c: number) => c >= 0 && !!map.cells[c]?.walkable
  for (const cell of map.cells) {
    if (!cell.walkable) continue
    for (const d of [1, 3, 5, 7]) {
      const back = (d + 4) & 7
      if (!ok(cellInDirection(cell.id, back, 1)) || !ok(cellInDirection(cell.id, back, 2))) continue
      const behind = [1, 2, 3, 4].map(k => cellInDirection(cell.id, d, k))
      if (wall ? (behind[0] < 0 || map.cells[behind[0]]?.walkable) : !behind.every(ok)) continue
      return { x: cell.id, d }
    }
  }
  throw new Error('aucune case')
}

function pushPart(wall: boolean): { push: number; pushRes: number } {
  const engine = engineFor()
  const { x, d } = findLine(wall)
  const me = player(BREEDS.iop, { cell: x, name: 'Iop' })
  const b = monster(BRABUZAR, cellInDirection(x, (d + 4) & 7, 2))
  const fight = makeFight(engine, VORTEX_MAP, [me, b])
  engine.nextTurn(fight)
  const meF = fight.fighters.find(f => f.name === 'Iop')!
  const bF = fight.fighters.find(f => f.monsterId === BRABUZAR)!
  bF.stats.mp = 0 // une seule case de lancer : la poussée suit la ligne Brabuzar → Iop
  const view = createView(engine, fight, meF, 1)
  const p = createPerception(view)
  p.sync(fight)
  const th = p.threat as unknown as { rowOf(e: unknown): { dmg: Float64Array; full: Float64Array; hit: Float64Array } | undefined; allyIdx(id: number): number }
  const row = th.rowOf(bF)!
  const ai = th.allyIdx(meF.id)
  return { push: row.dmg[ai] - row.full[ai] * row.hit[ai], pushRes: meF.stats.pushRes }
}

describe('menace : dommages de collision des poussées (Brabuzar)', () => {
  it('cible dos au mur : force entière (4 cases) × (niveau/2 + 32 + 200 − Ré Pou) / 4', () => {
    const { push, pushRes } = pushPart(true)
    expect(push).toBeCloseTo(Math.trunc(Math.floor(212 / 2) + 32 + 200 - pushRes), 0)
  })
  it('cible avec 4 cases libres derrière : aucune collision', () => {
    expect(pushPart(false).push).toBeCloseTo(0, 6)
  })
})
