// Compare, manche par manche, les tableaux « 3. Cases des bombes » du chercheur (fin/F1..F3.txt : SORTIES texte, pas
// son code) avec mon simulateur, pour plusieurs sémantiques de chaîne.
import { readFileSync } from 'node:fs'
import { run, type Variant, type Timing, type Chain, type TargetOrder, type Plan } from './sim.ts'
import { FA, FC, FB } from './plans.ts'

const S = 'tools/reine-des-voleurs/v2/search/fin/'
const FILES: [string, Plan, number[]][] = [
  ['F3.txt', FA, [365, 437, 378, 451]],
  ['F1.txt', FC, [365, 437, 378, 451]],
  ['F2.txt', FB, [340, 367, 365, 437]],
]

function parse(file: string) {
  const txt = readFileSync(S + file, 'utf8').split('\n')
  const blocks = new Map<string, string[]>()
  let cur: string | null = null
  let inSec3 = false
  for (const l of txt) {
    if (l.startsWith('== 3.')) { inSec3 = true; continue }
    if (l.startsWith('== ') && inSec3) { inSec3 = false; cur = null; continue }
    if (!inSec3) continue
    const mb = l.match(/^\s+-- (\w)\/(suivant|même)/)
    if (mb) { cur = `${mb[1]} ${mb[2] === 'suivant' ? 'TS' : 'MT'}`; blocks.set(cur, []); continue }
    const mr = l.match(/^\s+m\s*(\d+) apparitions (.*?)\s+explosions(.*?)\s+soins(.*)$/)
    if (mr && cur) blocks.get(cur)!.push(`m${mr[1]} | ${mr[2].trim()} | ${mr[3].trim()} | ${mr[4].trim()}`)
  }
  return blocks
}

function mine(plan: Plan, refCells: number[], v: Variant, t: Timing, ch: Chain, to: TargetOrder, pending: boolean) {
  const order = refCells.map((c) => plan.start.indexOf(c))
  const J = (slot: number) => order.indexOf(slot) + 1
  const r = run({ plan, variant: v, timing: t, chain: ch, order, rounds: 10, trace: true, targetOrder: to, pending })
  // reconstruit par manche à partir du journal
  const lines: string[] = []
  let app: string[] = [], exp: string[] = [], heal = new Set<number>()
  let m = 0
  const flush = () => { if (m) lines.push(`m${m} | ${app.join(' ')} | ${exp.join(' ')} | ${[...heal].sort().map((j) => 'J' + j).join(',')}`) }
  for (const l of r.log) {
    let x
    if ((x = l.match(/^— manche (\d+)/))) { flush(); m = +x[1]; app = []; exp = []; heal = new Set(); continue }
    if ((x = l.match(/^\s+J(\d) \[\d+\] bombe (-?\d+)\((\S+?)\)/))) { const slot = +x[1] - 1; app.push(`J${J(slot)}:${x[2]}${x[3] === 'repli' ? "'" : x[3] === 'N' ? '' : '!'}`); continue }
    if ((x = l.match(/^\s+(ROUGE|BLEUE) (\d+)/))) { exp.push(`${x[2]}${x[1] === 'ROUGE' ? 'R' : 'b'}`); continue }
    if ((x = l.match(/\+ soin J(\d)/))) { heal.add(J(+x[1] - 1)); continue }
  }
  flush()
  // apparitions triées par J
  return lines.map((l) => { const [a, b, c, d] = l.split(' | '); return [a, b.split(' ').sort().join(' '), c, d].join(' | ') })
}

const SEMS: [Chain, TargetOrder, boolean][] = []
for (const ch of ['dfs', 'bfs', 'imm'] as Chain[]) for (const to of ['near', 'nearc', 'nearcw', 'far', 'id', 'idrev'] as TargetOrder[]) for (const p of [false, true]) SEMS.push([ch, to, p])

for (const [file, plan, ref] of FILES) {
  const blocks = parse(file)
  console.log(`\n##### ${file} = ${plan.name} (ordre ${ref.join('→')})`)
  for (const [key, theirs] of blocks) {
    const [v, t] = key.split(' ') as [Variant, Timing]
    const th = theirs.map((l) => { const [a, b, c, d] = l.split(' | '); return [a, b.split(' ').sort().join(' '), c, d].join(' | ') })
    const exact: string[] = [], setEq: string[] = []
    for (const [ch, to, p] of SEMS) {
      const mn = mine(plan, ref, v, t, ch, to, p)
      const name = `${ch}/${to}${p ? '/pend' : ''}`
      if (mn.join('\n') === th.join('\n')) exact.push(name)
      // égalité « ensemble » : apparitions, multiensemble des explosions (cellule+couleur), soins
      const norm = (arr: string[]) => arr.map((l) => { const [a, b, c, d] = l.split(' | '); return [a, b, c.split(' ').sort().join(' '), d].join(' | ') }).join('\n')
      if (norm(mn) === norm(th)) setEq.push(name)
    }
    console.log(`  ${key}: identique (ordre des explosions compris) pour [${exact.join(' ')}] ; identique à l'ordre près pour [${setEq.filter((x) => !exact.includes(x)).join(' ')}]`)
    if (!exact.length) {
      const mn = mine(plan, ref, v, t, (process.env.CH ?? 'dfs') as Chain, (process.env.TO ?? 'near') as TargetOrder, false)
      for (let i = 0; i < th.length; i++) if (mn[i] !== th[i]) console.log(`     ≠ chercheur ${th[i]}\n       moi(${process.env.CH ?? 'dfs'}/${process.env.TO ?? 'near'}) ${mn[i]}`)
    }
  }
}
