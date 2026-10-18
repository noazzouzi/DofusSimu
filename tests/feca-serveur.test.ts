/**
 * Serveur de plans du Féca (tools/feca/serveur.ts), de bout en bout : journal synthétique d'un Féca seul au Roc des
 * Salbatroces (arène 140517635) envoyé comme par AnkaBot, sans le début de son tour (silence du journal pendant son tour,
 * QUIET_FROM_MY_TURN), puis une demande de plan avec l'état visible (ENVOYER_ETAT) : le serveur recale l'état, prend le
 * planificateur du Féca et répond un plan fait de ses sorts.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFecaServer } from '../tools/feca/serveur'
import { data } from '../tools/reine-des-voleurs/planificateur/etat'

const PORT = 8799
const CARTE = 140517635
const FECA = 900000000001
const SORTS = [12983, 12978, 13015, 12976, 13009, 12979, 12977, 12993, 12995, 13022, 12994, 12986, 13013, 13023, 12987,
  13025, 13027, 13011, 29045, 12991, 12988, 12982]
/** Monstres : identifiant de jeu → [espèce, case]. Malamibe (3822) en 94. */
const MONSTRES: Record<number, [number, number]> = { [-1]: [3825, 65], [-2]: [3824, 92], [-3]: [3826, 274], [-4]: [3825, 302], [-5]: [3822, 94] }
const RESTAURATION: Record<number, number> = { 3825: 4948, 3824: 4942, 3826: 4953 }

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
const fighter = (id: number, cell: number) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      gcac: { gdeq: id > 0
        ? [carac(0, 4962), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 5), carac(13, 1100), carac(25, 150)]
        : [carac(0, MONSTRES[id][0] === 3822 ? 2001 : 1000), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 5)] },
      gcad: { gdns: id > 0 ? 0 : 1 },
      ...(id > 0 ? { gcah: { gbyn: 'Feca', gbyr: { gbxy: 1, gbyc: 200 } } } : { gcai: { gbzm: { gbyz: MONSTRES[id][0], gbyx: 5, gbyy: 212 } } }),
    },
  },
})

describe('serveur de plans du Féca', () => {
  let srv: ReturnType<typeof startFecaServer>
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'feca-serveur-'))
    srv = startFecaServer({ port: PORT, logsDir: dir, quiet: true })
  })
  afterAll(() => {
    srv?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('Féca seul, état visible envoyé : un plan du planificateur du Féca', async () => {
    let i = 0
    const at = new Date().toISOString()
    const m = (n: string, d: unknown) => ({ k: 'm', i: ++i, n, d, at })
    const ids = [FECA, ...Object.keys(MONSTRES).map(Number)]
    const cells: Record<number, number> = { [FECA]: 429, ...Object.fromEntries(Object.entries(MONSTRES).map(([k, v]) => [k, v[1]])) }
    const lines = [
      m('hkh', { fnvq: SORTS.map(s => ({ fnve: s, fnvh: data.spell(s)?.levels.length ?? 1 })) }),
      m('jvi', { fxjj: 1 }),
      m('jvu', { fxlo: ids.map(g => ({ fxkv: { fxld: g } })) }),
      m('juo', { fxgj: ids.map(id => fighter(id, cells[id])) }),
      ...ids.filter(id => RESTAURATION[MONSTRES[id]?.[0]]).map(id =>
        m('juh', { fxet: { gdzl: { gdps: 0, gdpt: { gcqz: 0, gcra: 4 }, gdpw: ++i, gdpx: 0, gdpz: id, gdqb: 0, gdqf: 'I', gdqh: RESTAURATION[MONSTRES[id][0]] }, gdzm: 141, gdzn: id } })),
    ]
    await fetch(`http://127.0.0.1:${PORT}/log?c=Feca&i=essai`, { method: 'POST', body: lines.map(l => JSON.stringify(l)).join('\n') })
    const entites = ids.map(id => `${id}:${cells[id]}:${id > 0 ? 4962 : 1000}:0:12:5:${id > 0 ? 0 : MONSTRES[id][0]}`).join(';')
    const body = `case=429\npa=12\npm=5\ncarte=${CARTE}\nattente=3000\nmanche=1\nentites=${entites}\nlances=\ntour=1`
    const text = await (await fetch(`http://127.0.0.1:${PORT}/plan?c=Feca`, { method: 'POST', body })).text()
    expect(text).toMatch(/^plan -?\d+ \d+ 0 \d+ \d+/)
    expect(text.split('\n').at(-1)).toBe('fin')
    const casts = [...text.matchAll(/\nsort (\d+) /g)].map(x => Number(x[1]))
    expect(casts.length).toBeGreaterThan(0)
    for (const s of casts) expect(SORTS).toContain(s)

    // Plan rapide (PLAN_RAPIDE, 2026-10-18) : même état, réglages réduits, premier fil seul ; un plan de ses sorts aussi.
    const t0 = Date.now()
    const vite = await (await fetch(`http://127.0.0.1:${PORT}/plan?c=Feca`, { method: 'POST', body: `${body}\nrapide=1` })).text()
    const ms = Date.now() - t0
    expect(vite).toMatch(/^plan -?\d+ \d+ 0 \d+ \d+/)
    expect(vite.split('\n').at(-1)).toBe('fin')
    for (const s of [...vite.matchAll(/\nsort (\d+) /g)].map(x => Number(x[1]))) expect(SORTS).toContain(s)
    expect(Number(vite.split(/\s/)[1])).toBeLessThanOrEqual(Number(text.split(/\s/)[1]))
    expect(ms).toBeLessThan(5000)
  }, 120_000)
})
