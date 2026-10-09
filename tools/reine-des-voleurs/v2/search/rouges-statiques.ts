// Ensembles de 4 cases rouges : sûrs en statique (personne ne bouge) pour chaque variante × moment (24 ordres × 2 chaînes).
import { loadMap, PERMS4, VARIANTS } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
const map = loadMap(); initFast(map)
const R = map.red
const rows: string[] = []
for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) for (let l = k + 1; l < 12; l++) {
  const S = [R[i], R[j], R[k], R[l]]
  const res: string[] = []
  let nSame = 0, nNext = 0, beyond = 0
  for (let v = 0; v < 5; v++) for (const t of [0, 1] as const) {
    let ok = 0
    for (const p of PERMS4) { const o = p.map(x => S[x]); let g = true; for (const ch of [0, 1] as const) { if (fastSim(o, { variant: v, timing: t, chain: ch, rounds: 30 })) { g = false; break } beyond += stats.beyond } if (g) ok++ }
    if (ok === 24) { if (t) nSame++; else nNext++ }
    res.push(`${VARIANTS[v].id}${t ? 'm' : 's'}${ok}`)
  }
  if (nSame >= 1) rows.push(`${S.join(',')} même:${nSame}/5 suivant:${nNext}/5 au-delà:${beyond} ${res.join(' ')}`)
}
console.log(rows.length, 'ensembles rouges sûrs en « même tour » pour ≥ 4 variantes')
for (const r of rows) console.log(r)
