/**
 * Serveur de plans de la Reine (tools/reine-des-voleurs/planificateur/serveur.ts), de bout en bout : les lots du combat
 * réel du 2026-10-10 lui sont renvoyés comme par les 4 journaux AnkaBot (personnage par personnage), jusqu'au début du
 * tour de Lamouit à la manche 3, puis le plan de Lamouit est demandé ; ensuite, après ses premières actions réelles, la
 * suite du tour. Sauté si le journal (non versionné) est absent.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startPlanServer } from '../tools/reine-des-voleurs/planificateur/serveur'

const FILE = 'data/fightlogs/2026-10-10/session-08-29-54.jsonl'
const PORT = 8797
const LAMOUIT = 900264624421

interface Batch { c: string; in?: string; lines: any[] }

/** Lots de la session, contenus complétés d'avance (en direct, les types sont connus : rien n'est en attente). */
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

describe.skipIf(!existsSync(FILE))('serveur de plans (combat réel du 2026-10-10)', () => {
  let srv: ReturnType<typeof startPlanServer>
  let dir: string
  let all: Batch[]
  let sent = 0
  const post = (b: Batch) =>
    fetch(`http://127.0.0.1:${PORT}/log?c=${encodeURIComponent(b.c)}${b.in ? `&i=${b.in}` : ''}`, { method: 'POST', body: b.lines.map(l => JSON.stringify(l)).join('\n') })
  /** Envoie les lots jusqu'à ce qu'un AUTRE personnage que Lamouit ait reçu `until` (ligne de message). */
  async function sendUntil(until: (o: any, round: number) => boolean) {
    const round = new Map<string, number>()
    for (const b of all.slice(0, sent)) for (const o of b.lines) if (o.n === 'jvi') round.set(b.c, o.d.fxjj)
    while (sent < all.length) {
      const b = all[sent++]
      await post(b)
      if (b.c === 'Lamouit') continue
      for (const o of b.lines) {
        if (o.n === 'jvi') round.set(b.c, o.d.fxjj)
        if (until(o, round.get(b.c) ?? 0)) return
      }
    }
  }
  const plan = async (body: string) => (await fetch(`http://127.0.0.1:${PORT}/plan?c=Lamouit`, { method: 'POST', body })).text()

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'reine-serveur-'))
    srv = startPlanServer({ port: PORT, logsDir: dir, quiet: true })
    all = batches()
  })
  afterAll(() => {
    srv?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('début du tour de Lamouit (manche 3) : un plan qui sort tirer et revient sur sa case', async () => {
    let started = false
    await sendUntil((o, r) => {
      if (r === 3 && o.n === 'jvj' && o.d?.fxjr === LAMOUIT) started = true
      return started && o.n === 'jsq' && !!o.d?.fwvi
    })
    // Pendant le calcul du plan, le récepteur répond tout de suite aux journaux (calcul dans un fil à part ; le
    // 2026-10-10, le calcul sur le fil principal retenait les envois des journaux AnkaBot et des tours ont été passés).
    const asked = plan('case=354\npa=12\npm=6')
    await new Promise(r => setTimeout(r, 400))
    const t0 = Date.now()
    await post({ c: 'Kemist-Skyler', lines: [] })
    expect(Date.now() - t0).toBeLessThan(300)
    const text = await asked
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^plan -?\d+ \d+ \d+ 354 \d+$/)
    expect(lines.at(-1)).toBe('fin')
    expect(lines.some(l => l.startsWith('sort '))).toBe(true)
    const moves = lines.filter(l => l.startsWith('deplacer '))
    if (moves.length) expect(moves.at(-1)!.split(' ')[1].split(',').at(-1)).toBe('354')
  }, 120_000)

  it('après sa première action réelle (déplacement en 383) : la suite du tour, depuis 383', async () => {
    await sendUntil(o => o.n === 'jnz' && o.d?.fwaf === LAMOUIT)
    const text = await plan('case=383')
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^plan -?\d+ \d+ \d+ 354 \d+$/)
    // Les sorts partent de 383 ou d'une case atteinte ensuite, jamais de la case de départ du tour.
    const first = lines.find(l => l.startsWith('sort ') || l.startsWith('deplacer '))!
    if (first.startsWith('sort ')) expect(first.split(' ')[6]).toBe('383')
    else expect(first.split(' ')[1].split(',')[0]).toBe('383')
  }, 120_000)

  it('par sondes : chaque demande répond tout de suite (« attendre »), puis le plan arrive', async () => {
    let text = ''
    let slowest = 0
    for (let n = 0; n < 200; n++) {
      const t0 = Date.now()
      text = await plan('case=383\nsonde=1')
      slowest = Math.max(slowest, Date.now() - t0)
      if (!text.startsWith('attendre')) break
      await new Promise(r => setTimeout(r, 100))
    }
    expect(slowest).toBeLessThan(300)
    expect(text.split('\n')[0]).toMatch(/^plan -?\d+ \d+ \d+ 354 \d+$/)
  }, 120_000)

  it('sondes longues : la réponse attend le plan (au plus « longue » ms), puis il part aussitôt', async () => {
    let text = ''
    let n = 0
    let slowest = 0
    for (; n < 50; n++) {
      const t0 = Date.now()
      // (refus différent : nouvelle demande, pas le plan déjà calculé par le test précédent)
      text = await plan('case=383\nsonde=1\nlongue=1000\nrefus=0@0@0')
      slowest = Math.max(slowest, Date.now() - t0)
      if (!text.startsWith('attendre')) break
    }
    expect(slowest).toBeLessThan(1500)
    expect(text.split('\n')[0]).toMatch(/^plan -?\d+ \d+ \d+ 354 \d+$/)
    // Une demande par seconde au plus pendant le calcul (au lieu d'une toutes les 100 ms).
    expect(n).toBeLessThan(15)
  }, 120_000)
})
