/**
 * Serveur de plans du Sacrieur de la Tanière du Meulou (tools/meulou/serveur.ts), de bout en bout : journal synthétique
 * de la salle 1 (carte 155713536, positions du combat du 2026-10-19) envoyé comme par AnkaBot, placement du Sacrieur et
 * d'une mule, puis une demande de plan avec l'état visible (ENVOYER_ETAT) : le serveur prend le planificateur du
 * Sacrieur et répond un plan fait de ses sorts.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SACRIEUR } from '../tools/meulou/meulou'
import { startMeulouServer } from '../tools/meulou/serveur'
import { data } from '../tools/reine-des-voleurs/planificateur/etat'

const PORT = 8796
const CARTE = 155713536
const SACRI = 900000000011
const MULE = 900000000012
/** Sorts de base du Sacrieur au niveau 190 (liste du jeu, message hkh : pas de variantes), au grade de ce niveau. */
const SORTS = data.breedSpells(11, 190)
  .map(x => data.spell(x.spellId)!)
  .filter(s => !s.variant)
  .map(s => ({ fnve: s.id, fnvh: s.levels.filter(l => l.minPlayerLevel <= 190).at(-1)?.grade ?? 1 }))
/** Monstres : identifiant de jeu → [espèce, case] (salle 1 : Mulou au contact du Sacrieur en 397, Cocholou, Mergranlou). */
const MONSTRES: Record<number, [number, number]> = { [-1]: [102, 383], [-2]: [4867, 270], [-3]: [4869, 325] }
const CASES = [397, 481, 494, 509, 520]

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
const fighter = (id: number, cell: number) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      gcac: { gdeq: id === SACRI
        ? [carac(0, 1000), carac(11, 2949), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 5), carac(10, 1048), carac(25, 80), carac(88, 69), carac(18, 42)]
        : id === MULE
          ? [carac(0, 118), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 6), carac(23, 3)]
          : [carac(0, 1800), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 10), carac(23, 5)] },
      gcad: { gdns: id > 0 ? 0 : 1 },
      ...(id === SACRI ? { gcah: { gbyn: SACRIEUR, gbyr: { gbxy: 11, gbyc: 190 } } }
        : id === MULE ? { gcah: { gbyn: 'Mule', gbyr: { gbxy: 9, gbyc: 10 } } }
        : { gcai: { gbzm: { gbyz: MONSTRES[id][0], gbyx: 1, gbyy: 92 } } }),
    },
  },
})

describe('serveur de plans du Sacrieur (Meulou)', () => {
  let srv: ReturnType<typeof startMeulouServer>
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'meulou-serveur-'))
    srv = startMeulouServer({ port: PORT, logsDir: dir, quiet: true })
  })
  afterAll(() => {
    srv?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('placement du Sacrieur au contact, mule ailleurs, puis un plan de ses sorts', async () => {
    const monstres = Object.values(MONSTRES).map(([e, c]) => `${e}@${c}`).join(';')
    const place = async (who: string, mule: boolean) =>
      (await fetch(`http://127.0.0.1:${PORT}/placement?c=${who}`, { method: 'POST', body: `carte=${CARTE}\nmonstres=${monstres}\ncases=${CASES.join(',')}${mule ? '\nmule=1' : ''}` })).text()
    const p1 = await place(SACRIEUR, false)
    const sacriCell = Number(p1.match(/^case (\d+)/)?.[1])
    // (397 : au contact du Mulou en 383)
    expect(sacriCell).toBe(397)
    const p2 = await place('Mule', true)
    const muleCell = Number(p2.match(/^case (\d+)/)?.[1])
    expect(CASES).toContain(muleCell)
    expect(muleCell).not.toBe(sacriCell)

    let i = 0
    const at = new Date().toISOString()
    const m = (n: string, d: unknown) => ({ k: 'm', i: ++i, n, d, at })
    const ids = [SACRI, MULE, ...Object.keys(MONSTRES).map(Number)]
    const cells: Record<number, number> = { [SACRI]: sacriCell, [MULE]: muleCell, ...Object.fromEntries(Object.entries(MONSTRES).map(([k, v]) => [k, v[1]])) }
    const lines = [
      m('hkh', { fnvq: SORTS }),
      m('jvi', { fxjj: 1 }),
      m('jvu', { fxlo: ids.map(g => ({ fxkv: { fxld: g } })) }),
      m('juo', { fxgj: ids.map(id => fighter(id, cells[id])) }),
    ]
    await fetch(`http://127.0.0.1:${PORT}/log?c=${SACRIEUR}&i=essai`, { method: 'POST', body: lines.map(l => JSON.stringify(l)).join('\n') })
    const hp = (id: number) => (id === SACRI ? 3949 : id === MULE ? 118 : 1800)
    const entites = ids.map(id => `${id}:${cells[id]}:${hp(id)}:${hp(id)}:${id === SACRI ? 12 : 10}:5:${id > 0 ? 0 : MONSTRES[id][0]}`).join(';')
    const body = `case=${sacriCell}\npa=12\npm=5\ncarte=${CARTE}\nattente=3000\nmanche=1\nentites=${entites}\nlances=\ntour=1`
    const text = await (await fetch(`http://127.0.0.1:${PORT}/plan?c=${SACRIEUR}`, { method: 'POST', body })).text()
    expect(text).toMatch(/^plan -?\d+ \d+ 0 \d+ \d+/)
    expect(text.split('\n').at(-1)).toBe('fin')
    const casts = [...text.matchAll(/\nsort (\d+) /g)].map(x => Number(x[1]))
    expect(casts.length).toBeGreaterThan(0)
    for (const s of casts) expect(SORTS.map(x => x.fnve)).toContain(s)
  }, 120_000)
})
