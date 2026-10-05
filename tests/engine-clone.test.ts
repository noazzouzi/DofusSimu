import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cloneBuff, cloneFighter } from '../src/engine/engine'

/** Champs déclarés d'une interface TypeScript (lecture du source : suffisant pour un garde-fou). */
function interfaceFields(name: string): string[] {
  const src = readFileSync('src/engine/types.ts', 'utf8')
  const start = src.indexOf(`export interface ${name} {`)
  const body = src.slice(start, src.indexOf('\n}\n', start))
  const out: string[] = []
  let depth = 0
  for (const line of body.split('\n').slice(1)) {
    const m = /^\s{2}([a-zA-Z_]+)\??:/.exec(line)
    if (m && depth === 0) out.push(m[1])
    depth += (line.match(/[{(]/g)?.length ?? 0) - (line.match(/[})]/g)?.length ?? 0)
    if (depth < 0) depth = 0
  }
  return out
}

describe('clonage explicite des combattants et des buffs', () => {
  it('cloneBuff recopie tous les champs déclarés de Buff', () => {
    const fields = interfaceFields('Buff')
    expect(fields.length).toBeGreaterThan(10)
    const b = Object.fromEntries(fields.map((k, i) => [k, i + 1])) as never
    const c = cloneBuff(b) as unknown as Record<string, unknown>
    for (const k of fields) expect(c[k], k).toBe(i(fields, k))
  })

  it('cloneFighter recopie tous les champs déclarés de Fighter (copies profondes des parties mutables)', () => {
    const fields = interfaceFields('Fighter')
    expect(fields.length).toBeGreaterThan(20)
    const f = Object.fromEntries(fields.map((k, idx) => [k, idx + 1])) as Record<string, unknown>
    Object.assign(f, { stats: { ap: 6 }, states: [1], buffs: [], cooldowns: { 1: 2 }, castsThisTurn: {}, castsOnTarget: {}, tags: { a: 1 } })
    const c = cloneFighter(f as never) as unknown as Record<string, unknown>
    for (const k of fields) {
      if (typeof f[k] === 'object') expect(c[k], k).toEqual(f[k])
      else expect(c[k], k).toBe(f[k])
    }
    expect(c.stats).not.toBe(f.stats)
    expect(c.tags).not.toBe(f.tags)
    expect(c.states).not.toBe(f.states)
  })
})

function i(fields: string[], k: string): number {
  return fields.indexOf(k) + 1
}
