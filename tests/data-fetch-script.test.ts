/**
 * scripts/fetch-dofusdb.mjs de bout en bout, sans réseau : le script (copié avec scripts/lib/ dans un dossier
 * temporaire qui lui sert de racine) interroge un faux serveur DofusDB local (node:http, DOFUSDB_API) qui sert les
 * fixtures 3.7 (tests/fixtures/dofusdb-3.7) pour /monsters et des listes vides ailleurs. Vérifie le BRANCHEMENT du
 * module de normalisation dans le script, que tests/data-fetch-schema.test.ts ne voit pas : grades normalisés publiés,
 * manifest.game, garde-fou des boss appelé, et écriture tout ou rien de data/dofusdb (un échec ne touche à rien).
 * Contexte : docs/research/dofusdb-api.md §10.4.
 */
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normGrade, type ApiMonsterGrade } from '../scripts/lib/dofusdb-normalize.mjs'
import type { RawManifest, RawMonster } from '../src/data/raw'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE_DIR = path.join(REPO, 'tests', 'fixtures', 'dofusdb-3.7')
type ApiMonster = { id: number; isBoss?: boolean; grades: ApiMonsterGrade[]; [key: string]: unknown }
const FIXTURES: ApiMonster[] = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), 'utf8')))
  .sort((a, b) => a.id - b.id)
const SENTINEL = 'SENTINELLE : fichier antérieur à l’extraction\n'

/** Variante du schéma servie par le faux serveur (simule un nouveau renommage de l'API). */
type Mode = 'ok' | 'resistances-renommees' | 'isBoss-renomme'
let mode: Mode = 'ok'
const renameKeys = (o: object, f: (k: string) => string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]))
function servedMonsters(): object[] {
  if (mode === 'resistances-renommees')
    return FIXTURES.map(m => ({ ...m, grades: m.grades.map(g => renameKeys(g, k => k.replace(/^reduction(Neutral|Earth|Fire|Water|Air)$/, 'resist$1'))) }))
  if (mode === 'isBoss-renomme') return FIXTURES.map(m => renameKeys(m, k => (k === 'isBoss' ? 'boss' : k)))
  return FIXTURES
}

let server: Server
let api = ''
beforeAll(async () => {
  // /monsters (1re page) = fixtures ; /<service>/<id> = 404 ; toute autre liste est vide.
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost')
    const service = u.pathname.slice(1)
    if (service.includes('/')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"name":"NotFound"}')
      return
    }
    const data = service === 'monsters' && u.searchParams.get('$skip') === '0' ? servedMonsters() : []
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ total: data.length, limit: 50, skip: 0, data }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Racine temporaire : le script et sa bibliothèque, et un data/dofusdb pré-rempli de fichiers sentinelles. */
function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dofussimu-fetch-'))
  roots.push(root)
  mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true })
  cpSync(path.join(REPO, 'scripts', 'fetch-dofusdb.mjs'), path.join(root, 'scripts', 'fetch-dofusdb.mjs'))
  cpSync(path.join(REPO, 'scripts', 'lib', 'dofusdb-normalize.mjs'), path.join(root, 'scripts', 'lib', 'dofusdb-normalize.mjs'))
  mkdirSync(path.join(root, 'data', 'dofusdb'), { recursive: true })
  for (const f of ['effects.json', 'monsters.json', 'manifest.json']) writeFileSync(path.join(root, 'data', 'dofusdb', f), SENTINEL)
  return root
}

/** Lance le script (processus enfant asynchrone : le faux serveur tourne dans ce processus). */
function runScript(root: string, args: string[] = []): Promise<{ code: number; output: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, DOFUSDB_API: api, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }
  delete env.NODE_USE_ENV_PROXY
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(root, 'scripts', 'fetch-dofusdb.mjs'), '--refresh', '--delay=0', ...args], { env, timeout: 30_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, output: `${stdout}${stderr}` }),
    )
  })
}

const outDir = (root: string) => path.join(root, 'data', 'dofusdb')
const readOut = <T,>(root: string, f: string): T => JSON.parse(readFileSync(path.join(outDir(root), f), 'utf8'))

describe('scripts/fetch-dofusdb.mjs contre un faux serveur DofusDB (fixtures 3.7)', () => {
  it('schéma 3.7 : grades normalisés publiés dans data/dofusdb, manifest.game 3.7, contrôles du Vortex', async () => {
    mode = 'ok'
    const root = makeRoot()
    const { code, output } = await runScript(root)
    expect(code, output).toBe(0)
    expect(output).toMatch(/schémas des grades : \{"3\.7":8\}/)
    expect(output).not.toMatch(/clés de grade inconnues/)
    // monsters.json : chaque grade = normGrade du grade brut 3.7 (résistances présentes, paLostDodge → paDodge…).
    const monsters = readOut<RawMonster[]>(root, 'monsters.json')
    expect(monsters.map(m => m.id)).toEqual(FIXTURES.map(m => m.id))
    for (const m of FIXTURES) expect(monsters.find(x => x.id === m.id)!.grades).toEqual(m.grades.map(normGrade))
    expect(monsters.find(m => m.id === 3835)!.grades.find(g => g.grade === 5)).toMatchObject({
      neutralResistance: 6, earthResistance: 33, fireResistance: 12, waterResistance: 21, airResistance: 28, paDodge: -24, pmDodge: 20,
    })
    const manifest = readOut<RawManifest>(root, 'manifest.json')
    expect(manifest.game).toMatchObject({ version: '3.7', gradeSchemas: { '3.7': 8 }, unknownGradeKeys: {} })
    expect(manifest.checks.vortexBossResPctAndDodge).toEqual([6, 33, 12, 21, 28, -24, 20])
    // Publication : les sentinelles sont remplacées, le dossier de préparation est vidé.
    expect(readFileSync(path.join(outDir(root), 'effects.json'), 'utf8')).not.toBe(SENTINEL)
    expect(Object.keys(manifest.files)).toContain('monsters.json')
    expect(existsSync(path.join(root, '.cache', 'dofusdb-out'))).toBe(false)
  })

  it('clés de résistance renommées encore : échec en français, data/dofusdb intact (aucun fichier publié)', async () => {
    mode = 'resistances-renommees'
    const root = makeRoot()
    const { code, output } = await runScript(root)
    expect(code).toBe(1)
    expect(output).toMatch(/Extraction DofusDB refusée : \d+ problème\(s\) sur les boss/)
    expect(output).toMatch(/Vortex \(3835\), grade 1 : neutralResistance, earthResistance, fireResistance, waterResistance, airResistance manquante/)
    expect(output).toMatch(/clés de grade inconnues/)
    expect(output).toMatch(/data\/dofusdb n'a pas été modifié/)
    // Les tables de référence (effects.json…) étaient déjà préparées avant l'échec : rien n'a été publié.
    expect(readdirSync(outDir(root)).sort()).toEqual(['effects.json', 'manifest.json', 'monsters.json'])
    for (const f of readdirSync(outDir(root))) expect(readFileSync(path.join(outDir(root), f), 'utf8'), f).toBe(SENTINEL)
  })

  it('champ isBoss renommé : échec (boss témoin), au lieu d’un contrôle des résistances qui passerait à vide', async () => {
    mode = 'isBoss-renomme'
    const root = makeRoot()
    const { code, output } = await runScript(root)
    expect(code).toBe(1)
    expect(output).toMatch(/aucun monstre isBoss parmi 5/)
    expect(output).toMatch(/Vortex \(3835\) : boss témoin plus marqué isBoss/)
    expect(readFileSync(path.join(outDir(root), 'monsters.json'), 'utf8')).toBe(SENTINEL)
  })
})
