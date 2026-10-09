import { readFileSync, writeFileSync } from 'node:fs'
const all: any[] = []
for (const f of process.argv.slice(2)) all.push(...JSON.parse(readFileSync(f, 'utf8')))
all.sort((a, b) => b.heal - a.heal || a.beyond - b.beyond || a.pmMax - b.pmMax || a.pmTot - b.pmTot)
writeFileSync('classe1.json', JSON.stringify(all))
console.log('ensembles 9/10 :', all.length, '; PM max ≤ 5 :', all.filter(o => o.pmMax <= 5).length, '; sans au-delà (échantillon) :', all.filter(o => o.beyond === 0).length)
const hist = new Map<number, number>()
for (const o of all) hist.set(o.heal, (hist.get(o.heal) ?? 0) + 1)
console.log('soins OK sur 24 (4 variantes × 6 ordres) :', [...hist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}:${v}`).join(' '))
const hv = new Map<string, number>()
for (const o of all) { const k = o.hv.map((x: number) => (x === 6 ? 'T' : x > 0 ? 'p' : '-')).join(''); hv.set(k, (hv.get(k) ?? 0) + 1) }
console.log('profil soins (A B D E ; T = 6/6 ordres, p = partiel, - = aucun) :', [...hv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}:${v}`).join(' '))
for (const o of all.slice(0, 40)) console.log(`${o.cells.join(',')} soins ${o.heal}/24 [${o.hv.join(' ')}] au-delà ${o.beyond} PM ${o.pmMax}/${o.pmTot} depuis ${o.S.join(',')}`)
