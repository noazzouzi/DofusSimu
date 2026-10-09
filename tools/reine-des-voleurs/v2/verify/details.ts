import { run, ORDERS, type Variant, type Timing, type Chain, type Plan, WALK } from './sim.ts'
import { FA, FC, FB, OLD } from './plans.ts'
import { neighborsOf, distance } from '../../../../src/map/geometry.ts'

const V5: Variant[] = ['A', 'B', 'C', 'D', 'E']
const VARS: Variant[] = ['A', 'B', 'C', 'D', 'E', 'E2']
const TIM: Timing[] = ['TS', 'MT']
const ordIdx = (p: Plan, cells: number[]) => cells.map((c) => p.start.indexOf(c))
const okRun = (r: ReturnType<typeof run>) => r.deaths.length === 0 && r.pathFail.length === 0

function count(plan: Plan, v: Variant, t: Timing, extra: Partial<Parameters<typeof run>[0]> = {}, chains: Chain[] = ['dfs', 'bfs']) {
  const out: string[] = []
  for (const ch of chains) {
    let ok = 0
    for (const ord of ORDERS) if (okRun(run({ plan, variant: v, timing: t, chain: ch, order: ord, ...extra }))) ok++
    out.push(`${ch}=${ok}/24`)
  }
  return out.join(' ')
}

console.log('### 1. Contrôle : ancienne formation, règle du README (NE2→E2→horaire)')
for (const t of TIM) console.log(`  NEold ${t}: ${count(OLD, 'NEold', t)}`)
console.log('### 1b. Ancienne formation sous les 5 lectures du joueur')
for (const v of V5) for (const t of TIM) console.log(`  ${v} ${t}: ${count(OLD, v, t)}`)

console.log('\n### 2. Sensibilité des 3 formations aux points de modèle non tranchés')
for (const plan of [FA, FC, FB]) {
  for (const v of VARS) for (const t of TIM) {
    const a = count(plan, v, t, { diagMax: 5 }, ['dfs', 'bfs', 'imm'])
    const b = count(plan, v, t, { blueColors: false }, ['dfs', 'bfs', 'imm'])
    console.log(`  ${plan.name} ${v} ${t}: diag≤5pas[${a}]  bleue-ne-colore-pas[${b}]`)
  }
}

console.log('\n### 3. Erreur de règle de décision (alternance appliquée à tort / oubliée)')
for (const plan of [FA, FC]) for (const v of VARS) for (const t of TIM) {
  const shouldAlt = plan.useAlt!(v, t)
  console.log(`  ${plan.name} ${v} ${t}: alternance ${shouldAlt ? 'OUBLIÉE' : 'appliquée À TORT'} → ${count(plan, v, t, { forceAlt: !shouldAlt })}`)
}

console.log('\n### 4. Cases de bombe (ordre J1..J4 = départs dans l\'ordre du plan, chaîne dfs)')
for (const plan of [FA, FC, FB]) for (const v of VARS) for (const t of TIM) {
  const prim = new Set<number>(), fb = new Set<number>(), red = new Set<number>(), blue = new Set<number>()
  const r = run({ plan, variant: v, timing: t, chain: 'dfs', order: [0, 1, 2, 3], trace: false })
  for (const [k, c] of r.spawnCells) { const rd = +k.split(':')[0]; if (rd >= 2) prim.add(c) }
  for (const e of r.explosions) (e.blue ? blue : red).add(e.cell)
  console.log(`  ${plan.name} ${v} ${t}: cases d'apparition (m≥2) ${[...prim].sort((a, b) => a - b).join(',')} ; repli ${r.fallback} ; au-delà ${r.beyond} ; explosions rouges {${[...red].sort((a, b) => a - b).join(',')}} bleues {${[...blue].sort((a, b) => a - b).join(',')}}`)
}

console.log('\n### 5. Soins par bombe bleue (TS) : écart max entre soins / 1er soin, sur 24 ordres × {dfs,bfs}')
for (const plan of [FA, FC, FB]) for (const v of VARS) for (const t of TIM) {
  let pass = 0, tot = 0
  const worst = [0, 0, 0, 0], firstWorst = [0, 0, 0, 0]
  for (const ch of ['dfs', 'bfs'] as Chain[]) for (const ord of ORDERS) {
    const r = run({ plan, variant: v, timing: t, chain: ch, order: ord })
    if (!okRun(r)) continue
    tot++
    let good = true
    for (let s = 0; s < 4; s++) {
      const h = r.heals[s]
      if (!h.length) { good = false; worst[s] = 99; continue }
      let g = 0
      for (let i = 1; i < h.length; i++) g = Math.max(g, h[i] - h[i - 1])
      if (h[h.length - 1] < 25) g = Math.max(g, 99)
      worst[s] = Math.max(worst[s], g); firstWorst[s] = Math.max(firstWorst[s], h[0])
      if (g > 5 || h[0] > 6) good = false
    }
    if (good) pass++
  }
  if (tot) console.log(`  ${plan.name} ${v} ${t}: critère (écart ≤5, 1er ≤ m6) ${pass}/${tot} ; écart max par case ${plan.home.map((c, i) => `${c}:${worst[i] === 99 ? 'jamais' : worst[i]}`).join(' ')} ; 1er soin au plus tard ${firstWorst.map((x, i) => `${plan.home[i]}:m${x}`).join(' ')}`)
}

console.log('\n### 6. Ennemi immobile sur une case (toute la durée, dès la manche 2) — cases mortelles (≥1 ordre ou chaîne casse, ou chemin bloqué)')
for (const plan of [FA, FC, FB]) {
  const occ = new Set([...plan.home, ...(plan.alt ?? [])])
  const region: number[] = []
  for (let c = 0; c < 560; c++) if (WALK[c] && !occ.has(c) && Math.min(...plan.home.map((h) => distance(h, c))) <= 3) region.push(c)
  for (const v of ['A', 'B', 'C', 'D', 'E'] as Variant[]) for (const t of TIM) {
    const base = ORDERS.filter((ord) => okRun(run({ plan, variant: v, timing: t, chain: 'dfs', order: ord })))
    if (!base.length) continue
    const mortal: number[] = []
    for (const c of region) {
      let bad = false
      for (const ord of base) {
        for (const ch of ['dfs', 'bfs'] as Chain[]) {
          if (!okRun(run({ plan, variant: v, timing: t, chain: ch, order: ord, enemies: new Set([c]), enemyFromRound: 2 }))) { bad = true; break }
        }
        if (bad) break
      }
      if (bad) mortal.push(c)
    }
    console.log(`  ${plan.name} ${v} ${t} (${region.length} cases testées, ${base.length} ordres sûrs) : ${mortal.join(',') || 'aucune'}`)
  }
}

console.log('\n### 7. Décalage subi d\'une case (manches 3–5, avant le tour de chacun des 4 Crâs, 4 voisins libres), retour à son tour — 8 premiers ordres sûrs, dfs')
for (const plan of [FA, FC, FB]) for (const v of ['A', 'C'] as Variant[]) for (const t of TIM) {
  const base = ORDERS.filter((ord) => okRun(run({ plan, variant: v, timing: t, chain: 'dfs', order: ord }))).slice(0, 8)
  if (!base.length) continue
  let tot = 0, bad = 0
  for (const ord of base) for (let slot = 0; slot < 4; slot++) for (let rd = 3; rd <= 5; rd++) for (const bs of [0, 1, 2, 3]) {
    // position du Crâ à ce moment : on la reconstitue en simulant sans décalage jusqu'à la manche rd (case tenue ou d'alternance)
    const useAlt = plan.useAlt ? plan.useAlt(v, t) : false
    const posOrd = ord.indexOf(slot), bsOrd = ord.indexOf(bs)
    const playedThisRound = posOrd < bsOrd
    const effRound = playedThisRound ? rd : rd - 1
    const cur = useAlt && effRound >= 2 && effRound % 2 === 0 ? plan.alt![slot] : plan.home[slot]
    for (const n of neighborsOf(cur)) {
      if (!WALK[n]) continue
      const r = run({ plan, variant: v, timing: t, chain: 'dfs', order: ord, displace: { slot, round: rd, beforeSlot: bs, to: n } })
      // le décalage a-t-il eu lieu ? (case libre) : sinon on ne compte pas
      const r0 = run({ plan, variant: v, timing: t, chain: 'dfs', order: ord, displace: { slot, round: rd, beforeSlot: bs, to: n }, trace: true })
      if (!r0.log.some((l) => l.includes('décalage'))) continue
      tot++
      if (!okRun(r)) bad++
    }
  }
  console.log(`  ${plan.name} ${v} ${t}: ${bad}/${tot} décalages mortels (${((100 * bad) / tot).toFixed(0)} %)`)
}
