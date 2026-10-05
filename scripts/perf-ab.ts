/**
 * Comparaison A/B ENTRELACÉE de deux versions du code dans un même processus (machine partagée/chargée : les deux
 * versions subissent la même charge). Chaque arbre (`--a`, `--b`) contient `src/`, `data/ai/` et
 * `scripts/perf-cases.ts` ; ils sont empaquetés (esbuild) puis chargés côte à côte.
 *
 *   npx tsx scripts/perf-ab.ts --a /chemin/ref --b /chemin/new [--micro] [--fights 1-6] [--rounds 15] [--slice 25]
 *
 *  - micro : pour chaque cas, `--rounds` tours de A puis B (tranches de `--slice` ms, ordre alterné) ; rapporte le
 *    MINIMUM et la MÉDIANE des tranches (µs/op), le temps CPU du fil cumulé (µs/op, moins sensible à la charge d'une
 *    machine partagée) et les rapports B/A. `--cases <regex>` : seulement ces cas.
 *  - combats : graines `--fights`, A puis B puis B puis A… (temps réel et CPU), après un combat de préchauffage chacun ;
 *    vérifie aussi que les empreintes (`eventsHash`) sont identiques. `--mode standard` ; `--turns N` : seulement les N
 *    premiers tours de combattants de chaque combat (mode standard : un combat complet dure plusieurs minutes).
 */
import { buildSync } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PerfCases } from './perf-cases'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def
}
function seedsOf(text: string): number[] {
  const out: number[] = []
  for (const part of text.split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part)
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s)
    else if (part) out.push(Number(part))
  }
  return out
}

async function load(dir: string, tag: string): Promise<PerfCases> {
  const out = join(mkdtempSync(join(tmpdir(), 'perf-ab-')), `${tag}.mjs`)
  buildSync({ entryPoints: [join(resolve(dir), 'scripts/perf-cases.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' })
  const mod = (await import(pathToFileURL(out).href)) as { createPerfCases: (d?: string) => PerfCases }
  return mod.createPerfCases(arg('data', 'data'))
}

const cpu = (): number => {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}
/** Temps CPU (ms) du fil principal (`process.threadCpuUsage`, Node ≥ 22.20 ; à défaut celui du processus). */
const threadCpu = (): number => {
  const p = process as unknown as { threadCpuUsage?: () => NodeJS.CpuUsage }
  const u = p.threadCpuUsage ? p.threadCpuUsage() : process.cpuUsage()
  return (u.user + u.system) / 1000
}
const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const fmt = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))

const A = await load(arg('a', ''), 'a')
const B = await load(arg('b', ''), 'b')

if (process.argv.includes('--micro')) {
  const ROUNDS = Number(arg('rounds', '15'))
  const SLICE = Number(arg('slice', '25'))
  const ma = A.micro()
  const mb = B.micro()
  console.log(`A ${ma.info}\nB ${mb.info}`)
  console.log(`${'cas'.padEnd(40)} ${'A min'.padStart(9)} ${'B min'.padStart(9)} ${'B/A'.padStart(6)}   ${'A méd'.padStart(9)} ${'B méd'.padStart(9)} ${'B/A'.padStart(6)}   ${'A CPU'.padStart(9)} ${'B CPU'.padStart(9)} ${'B/A'.padStart(6)}`)
  const only = arg('cases', '') ? new RegExp(arg('cases', '')) : null
  for (let ci = 0; ci < ma.cases.length; ci++) {
    const ca = ma.cases[ci]
    if (only && !only.test(ca.name)) continue
    const cb = mb.cases.find(c => c.name === ca.name)
    if (!cb || !ca.n || !cb.n) continue
    for (let i = 0; i < Math.min(ca.n, 100); i++) (ca.fn(i), cb.fn(i))
    const ta: number[] = []
    const tb: number[] = []
    let ka = 0
    let kb = 0
    // Temps CPU du fil (granularité ~4 ms : cumulé sur toutes les tranches, moins sensible à la charge que le temps réel).
    let cpuA = 0
    let cpuB = 0
    const slice = (c: typeof ca, k: number): [number, number, number] => {
      let ops = 0
      const c0 = threadCpu()
      const t0 = performance.now()
      let t = t0
      while (t - t0 < SLICE) {
        for (let j = 0; j < 8; j++) c.fn((k + ops + j) % c.n)
        ops += 8
        t = performance.now()
      }
      return [((t - t0) * 1000) / ops, ops, threadCpu() - c0]
    }
    for (let r = 0; r < ROUNDS; r++) {
      const order = r & 1 ? ['b', 'a'] : ['a', 'b']
      for (const w of order) {
        if (w === 'a') {
          const [us, ops, cpu] = slice(ca, ka)
          ta.push(us)
          ka += ops
          cpuA += cpu
        } else {
          const [us, ops, cpu] = slice(cb, kb)
          tb.push(us)
          kb += ops
          cpuB += cpu
        }
      }
    }
    const minA = Math.min(...ta)
    const minB = Math.min(...tb)
    const mdA = med(ta)
    const mdB = med(tb)
    const cA = (cpuA * 1000) / Math.max(1, ka)
    const cB = (cpuB * 1000) / Math.max(1, kb)
    console.log(`${ca.name.padEnd(40)} ${fmt(minA).padStart(9)} ${fmt(minB).padStart(9)} ${(minB / minA).toFixed(2).padStart(6)}   ${fmt(mdA).padStart(9)} ${fmt(mdB).padStart(9)} ${(mdB / mdA).toFixed(2).padStart(6)}   ${fmt(cA).padStart(9)} ${fmt(cB).padStart(9)} ${(cB / cA).toFixed(2).padStart(6)}`)
  }
}

const fightSeeds = seedsOf(arg('fights', ''))
if (fightSeeds.length) {
  const mode = arg('mode', 'fast') as 'fast' | 'standard'
  const turns = Number(arg('turns', '0'))
  A.fight('fast', 99)
  B.fight('fast', 99)
  let wa = 0
  let wb = 0
  let ca = 0
  let cb = 0
  let mismatch = 0
  for (let i = 0; i < fightSeeds.length; i++) {
    const seed = fightSeeds[i]
    const run = (pc: PerfCases): [number, number, number] => {
      const t0 = performance.now()
      const c0 = cpu()
      if (turns > 0) {
        pc.turns(mode, seed, turns)
        return [performance.now() - t0, cpu() - c0, 0]
      }
      const r = pc.fight(mode, seed)
      return [performance.now() - t0, cpu() - c0, r.digest]
    }
    const [ra, rb] = i & 1 ? (() => { const b = run(B); const a = run(A); return [a, b] })() : (() => { const a = run(A); const b = run(B); return [a, b] })()
    wa += ra[0]
    wb += rb[0]
    ca += ra[1]
    cb += rb[1]
    if (ra[2] !== rb[2]) mismatch++
    console.log(`graine ${seed} : A ${ra[0].toFixed(0)} ms (CPU ${ra[1].toFixed(0)}) | B ${rb[0].toFixed(0)} ms (CPU ${rb[1].toFixed(0)}) | B/A ${(rb[0] / ra[0]).toFixed(2)}${ra[2] !== rb[2] ? ' EMPREINTES DIFFÉRENTES' : ''}`)
  }
  const n = fightSeeds.length
  console.log(`combat ${mode} moyen : A ${(wa / n).toFixed(0)} ms (CPU ${(ca / n).toFixed(0)}) | B ${(wb / n).toFixed(0)} ms (CPU ${(cb / n).toFixed(0)}) | B/A réel ${(wb / wa).toFixed(3)} CPU ${(cb / ca).toFixed(3)} | empreintes différentes : ${mismatch}`)
}
