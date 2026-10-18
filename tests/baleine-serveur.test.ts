/**
 * Serveur de plans du Ventre de la Baleine (tools/ventre-de-la-baleine/serveur.ts), de bout en bout : placement de la
 * salle 2 demandé par les 4 Crâs (une case chacun, réponse stable), puis les lots du combat de la salle 1 du 2026-10-14
 * renvoyés comme par les 4 journaux AnkaBot jusqu'au début du tour de Lamouit en manche 2, et son plan. Combat (non
 * versionné) absent : seul le placement est essayé.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBaleineServer } from '../tools/ventre-de-la-baleine/serveur'

const FILE = 'data/fightlogs/2026-10-14/session-12-04-36.jsonl'
const PORT = 8798
const LAMOUIT = 900264624421
const CASES_SALLE_2 = [272, 300, 327, 329, 331, 342, 346, 357, 358, 384]

interface Batch { c: string; in?: string; lines: any[] }

/** Lots de la session, contenus complétés d'avance (comme tests/reine-serveur.test.ts). */
function batches(): Batch[] {
  const raw = readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  const done = new Map<string, any>()
  let inst = ''
  for (const o of raw) {
    if (o.k === 'b') inst = o.in ?? ''
    else if (o.k === 'p') done.set(`${inst}:${o.of}`, o.d)
  }
  const out: Batch[] = []
  for (const o of raw) {
    if (o.k === 'b') out.push({ c: o.c, in: o.in, lines: [] })
    else if (o.k !== 'p' && (o.k === 'm' || o.k === 'e')) {
      const d = done.get(`${out.at(-1)?.in ?? ''}:${o.i}`)
      out.at(-1)?.lines.push(d !== undefined ? { ...o, d } : o)
    }
  }
  return out
}

describe('serveur de plans du Ventre de la Baleine', () => {
  let srv: ReturnType<typeof startBaleineServer>
  let dir: string
  const url = (route: string, c: string) => `http://127.0.0.1:${PORT}/${route}?c=${encodeURIComponent(c)}`

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'baleine-serveur-'))
    srv = startBaleineServer({ port: PORT, logsDir: dir, quiet: true })
  })
  afterAll(() => {
    srv?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('placement de la salle 2 : une case de placement différente par Crâ, la même à chaque demande', async () => {
    const body = `carte=140772356\nmonstres=3824@352;3825@282;3825@409;3827@324\ncases=${CASES_SALLE_2.join(',')}`
    const ask = async (c: string) => (await fetch(url('placement', c), { method: 'POST', body })).text()
    const names = ['Lowkey-Jealous', 'Java-Springboot', 'Lamouit', 'Kemist-Skyler']
    const cells: number[] = []
    for (const n of names) {
      const r = await ask(n)
      expect(r).toMatch(/^case \d+ [\d,]+$/)
      cells.push(Number(r.split(' ')[1]))
    }
    expect(new Set(cells).size).toBe(4)
    for (const c of cells) expect(CASES_SALLE_2).toContain(c)
    expect(Number((await ask('Lamouit')).split(' ')[1])).toBe(cells[2])
  }, 60_000)

  it.skipIf(!existsSync(FILE))('début du tour de Lamouit (salle 1, manche 2) : un plan', async () => {
    const all = batches()
    const round = new Map<string, number>()
    let seen = false
    for (const b of all) {
      await fetch(`http://127.0.0.1:${PORT}/log?c=${encodeURIComponent(b.c)}${b.in ? `&i=${b.in}` : ''}`, { method: 'POST', body: b.lines.map(l => JSON.stringify(l)).join('\n') })
      if (b.c === 'Lamouit') continue
      for (const o of b.lines) {
        if (o.n === 'jvi') round.set(b.c, o.d.fxjj)
        if (round.get(b.c) === 2 && o.n === 'jvj' && o.d?.fxjr === LAMOUIT) seen = true
      }
      if (seen) break
    }
    expect(seen).toBe(true)
    const text = await (await fetch(url('plan', 'Lamouit'), { method: 'POST', body: 'case=403\npa=12\npm=6\ncarte=140771332\nattente=0' })).text()
    expect(text).toMatch(/^plan -?\d+ \d+ 0 \d+ \d+/)
    expect(text.split('\n').at(-1)).toBe('fin')
    expect(text).toMatch(/\nsort \d+ \d+ (case|soi|allie|ennemi) \d+ -?\d+ \d+/)
  }, 120_000)
})
