import { run, ORDERS, perms, RED, WALK, type Variant, type Timing, type Chain, type TargetOrder, type Plan } from './sim.ts'
import { FA, FC, FB } from './plans.ts'
import { CELL_X, CELL_Y, distance, pointToCell, neighborsOf, cellInDirection } from '../../../../src/map/geometry.ts'

const V5: Variant[] = ['A', 'B', 'C', 'D', 'E']
const TIM: Timing[] = ['TS', 'MT']
const ok = (r: ReturnType<typeof run>) => r.deaths.length === 0 && r.pathFail.length === 0

console.log('### A. Tableau « section 1 » du chercheur, avec SA sémantique reconstituée (imm/nearcw) et les autres')
for (const plan of [FA, FC, FB]) {
  console.log(`  ${plan.name}`)
  for (const v of V5) for (const t of TIM) {
    const parts: string[] = []
    let fb = 0, bey = 0
    for (const [ch, to] of [['imm', 'nearcw'], ['dfs', 'near'], ['bfs', 'near'], ['bfs', 'nearcw']] as [Chain, TargetOrder][]) {
      let n = 0
      for (const ord of ORDERS) { const r = run({ plan, variant: v, timing: t, chain: ch, targetOrder: to, order: ord }); if (ok(r)) n++; if (ch === 'imm') { fb += r.fallback; bey += r.beyond } }
      parts.push(`${ch}/${to}=${n}/24`)
    }
    console.log(`    ${v}/${t === 'TS' ? 'suivant' : 'même'}  ${parts.join('  ')}  replis ${fb}  au-delà ${bey}`)
  }
}

console.log('\n### B. Ordre de chaîne ALÉATOIRE (cibles de chaque explosion mélangées), 40 graines × 24 ordres × {dfs,bfs,imm} × {gelé,pending}')
for (const plan of [FA, FC, FB]) for (const v of V5) for (const t of TIM) {
  // ordres sûrs de référence
  const base = ORDERS.filter((ord) => ok(run({ plan, variant: v, timing: t, chain: 'imm', targetOrder: 'nearcw', order: ord })))
  if (!base.length) continue
  let tot = 0, bad = 0
  const ex: string[] = []
  for (const ord of base) for (const ch of ['dfs', 'bfs', 'imm'] as Chain[]) for (const pending of [false, true]) for (let seed = 1; seed <= 40; seed++) {
    tot++
    const r = run({ plan, variant: v, timing: t, chain: ch, targetOrder: 'rand', seed, pending, order: ord })
    if (!ok(r)) { bad++; if (ex.length < 2) ex.push(`${ord.map((s) => plan.start[s]).join('→')} ${ch}${pending ? '/pend' : ''} graine ${seed}: ${JSON.stringify(r.deaths[0])}`) }
  }
  console.log(`  ${plan.name} ${v} ${t}: ${bad}/${tot} runs avec mort ${ex.length ? '— ex. ' + ex.join(' | ') : ''}`)
}

console.log('\n### C. Départs rouges, explosion « même tour » : la 1re bombe (posée depuis la case rouge du 1er joueur, les 3 autres encore sur leurs cases rouges) est-elle en ligne avec un autre Crâ ?')
{
  const PRIM: Record<string, [number, number]> = { A: [-1, 1], B: [-1, 1], C: [-2, 2], D: [-2, 2], E: [-2, 2] }
  const FB_: Record<string, [number, number]> = { A: [0, 2], B: [-1, 2], C: [0, 2], D: [-2, 3], E: [0, 4] }
  const at = (c: number, d: [number, number]) => pointToCell(CELL_X[c] + d[0], CELL_Y[c] + d[1])
  const line = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10
  const sets: number[][] = []
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) for (let d = c + 1; d < 12; d++) sets.push([RED[a], RED[b], RED[c], RED[d]])
  const safeFor = (S: number[], v: string) => S.every((s) => {
    const occ = (x: number) => x < 0 || !WALK[x] || S.includes(x)
    let b = at(s, PRIM[v]); if (occ(b)) { b = at(s, FB_[v]); if (occ(b)) return false /* au-delà : inconnu → non sûr */ }
    return !S.some((o) => o !== s && line(b, o))
  })
  let nAB = 0, nCDE = 0, nBoth = 0
  const both: string[] = []
  for (const S of sets) {
    const ab = safeFor(S, 'A') && safeFor(S, 'B')
    const cde = safeFor(S, 'C') && safeFor(S, 'D') && safeFor(S, 'E')
    if (ab) nAB++
    if (cde) nCDE++
    if (ab && cde) { nBoth++; both.push(S.join('/')) }
  }
  console.log(`  ${sets.length} départs : sûrs {A,B} = ${nAB} ; sûrs {C,D,E} = ${nCDE} ; sûrs pour les deux = ${nBoth} ${both.slice(0, 5).join(' ')}`)
  // Sans exclure 325/369
}

console.log('\n### D. Ordre d\'initiative de F-A / F-C en N2 + même tour : quels ordres passent ?')
for (const plan of [FA, FC]) for (const v of ['A', 'B'] as Variant[]) {
  const good = ORDERS.filter((ord) => ok(run({ plan, variant: v, timing: 'MT', chain: 'imm', targetOrder: 'nearcw', order: ord }))).map((o) => o.map((s) => plan.start[s]).join('→'))
  console.log(`  ${plan.name} ${v}/même: ${good.length}/24 : ${good.join(' | ')}`)
  // trace d'un ordre qui casse
}

console.log('\n### E. « Variante plus robuste » 339/406/426/493 depuis 365/378/437/451 : toutes les affectations, statique et avec alternance SE')
{
  const start = [365, 378, 437, 451]
  for (const home of perms([339, 406, 426, 493])) {
    if (home.some((h, i) => distance(start[i], h) > 5)) continue
    for (const alt of [false, true]) {
      const plan: Plan = { name: 'R', start, home, alt: home.map((h) => cellInDirection(h, 1)), useAlt: alt ? (v, t) => (v === 'C' || v === 'D' || v === 'E') && t === 'TS' : undefined }
      const cells: string[] = []
      let tot = 0
      for (const v of V5) for (const t of TIM) {
        let n = 0
        for (const ord of ORDERS) if (ok(run({ plan, variant: v, timing: t, chain: 'imm', targetOrder: 'nearcw', order: ord })) && ok(run({ plan, variant: v, timing: t, chain: 'bfs', order: ord }))) n++
        cells.push(`${v}${t === 'TS' ? 's' : 'm'}:${n}`)
        if (n === 24) tot++
      }
      console.log(`  ${start.map((s, i) => s + '→' + home[i]).join(' ')}${alt ? ' +alt' : ''} : ${tot}/10 à 24/24 — ${cells.join(' ')}`)
    }
  }
}
