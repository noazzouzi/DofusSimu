/**
 * Banc de performance reproductible des chemins chauds (moteur + socle IA) : micro-bancs sur un corpus d'états réels
 * (débuts de tours de combats Vortex `fast`, équipe méta, graines fixes) et combats complets — cas définis dans
 * `scripts/perf-cases.ts`.
 *
 *   npx tsx scripts/perf-bench.ts                    # micro-bancs + combats fast (graines 1-5, après préchauffage)
 *   npx tsx scripts/perf-bench.ts --only micro       # micro-bancs seulement
 *   npx tsx scripts/perf-bench.ts --only fights --seeds 1-10 --std-turns 8 [--std-full]
 *   npx tsx scripts/perf-bench.ts --json out.json    # résultats en JSON
 *
 * Chaque micro-banc parcourt le corpus en boucle pendant ≥ `--ms` ms (défaut 300), 7 répétitions : MINIMUM en µs/op
 * (le moins sensible à la charge d'une machine partagée). Combats : temps réel et temps CPU du processus, après un
 * combat de préchauffage (JIT, caches de module chauds : cas d'une campagne Monte-Carlo) ; le premier combat « à
 * froid » du processus est aussi rapporté. Sur une machine chargée, préférer la comparaison A/B entrelacée dans un même
 * processus (deux versions de `perf-cases.ts` chargées côte à côte).
 */
import { writeFileSync } from 'node:fs'
import { createPerfCases, type MicroCase } from './perf-cases'

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

const only = arg('only', 'all')
const MS = Number(arg('ms', '300'))
const results: Record<string, number> = {}
const t00 = performance.now()
const pc = createPerfCases()

function report(name: string, value: number, unit: string): void {
  results[name] = value
  const v = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
  console.log(`${name.padEnd(44)} ${v.padStart(10)} ${unit}`)
}

/** Minimum (7 répétitions de ≥ MS ms) du coût par opération, en µs. */
function measure(c: MicroCase): void {
  if (c.n === 0) return console.log(`${c.name.padEnd(44)} (corpus vide)`)
  for (let i = 0; i < Math.min(c.n, 200); i++) c.fn(i) // préchauffage
  let best = Infinity
  let k = 0
  for (let r = 0; r < 7; r++) {
    let ops = 0
    const t0 = performance.now()
    let t = t0
    while (t - t0 < MS) {
      for (let j = 0; j < 16; j++) c.fn(k++ % c.n)
      ops += 16
      t = performance.now()
    }
    best = Math.min(best, ((t - t0) * 1000) / ops)
  }
  report(c.name, best, 'µs/op')
}

const cpu = (): number => {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}

function runFights(): void {
  const seeds = seedsOf(arg('seeds', '1-5'))
  const stdTurns = Number(arg('std-turns', '0'))
  const stdSeeds = seedsOf(arg('std-seeds', '1-3'))
  let t0 = performance.now()
  let c0 = cpu()
  pc.fight('fast', 99) // premier combat du processus (à froid)
  report('combat fast à froid (graine 99)', performance.now() - t0, 'ms')
  report('  (CPU)', cpu() - c0, 'ms')
  let total = 0
  let totalCpu = 0
  let rounds = 0
  const per: string[] = []
  for (const seed of seeds) {
    t0 = performance.now()
    c0 = cpu()
    const r = pc.fight('fast', seed)
    const ms = performance.now() - t0
    total += ms
    totalCpu += cpu() - c0
    rounds += r.rounds
    per.push(`${seed}:${ms.toFixed(0)}`)
  }
  console.log(`  par graine (ms) ${per.join(' ')}`)
  report(`combat fast moyen (graines ${arg('seeds', '1-5')})`, total / seeds.length, 'ms')
  report('  (CPU)', totalCpu / seeds.length, 'ms')
  report('  ⇒ ms par tour de jeu (fast)', total / Math.max(1, rounds), 'ms')
  if (stdTurns > 0) {
    t0 = performance.now()
    for (const seed of stdSeeds) pc.turns('standard', seed, stdTurns)
    report(`standard ${stdTurns} tours moyen (graines ${arg('std-seeds', '1-3')})`, (performance.now() - t0) / stdSeeds.length, 'ms')
  }
  if (process.argv.includes('--std-full')) {
    t0 = performance.now()
    const r = pc.fight('standard', stdSeeds[0])
    report(`combat standard complet (graine ${stdSeeds[0]}, ${r.rounds} tours)`, performance.now() - t0, 'ms')
  }
}

function runMicro(): void {
  const t0 = performance.now()
  const { cases, info, nodesPerDecision } = pc.micro()
  console.log(`${info} (${(performance.now() - t0).toFixed(0)} ms)`)
  for (const c of cases) measure(c)
  const dec = results['décision joueur fast']
  if (dec !== undefined) report('  ⇒ µs par nœud (décision fast)', dec / Math.max(1, nodesPerDecision()), 'µs/nœud')
}

if (only === 'all' || only === 'fights') runFights()
if (only === 'all' || only === 'micro') runMicro()
console.log(`total ${(performance.now() - t00).toFixed(0)} ms`)
const json = arg('json', '')
if (json) writeFileSync(json, JSON.stringify(results, null, 1))
