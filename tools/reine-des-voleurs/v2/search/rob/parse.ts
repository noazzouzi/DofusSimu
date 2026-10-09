import { readFileSync, readdirSync } from 'node:fs'
const dir = 'tools/reine-des-voleurs/v2/search/rob'
const rows: any[] = []
for (const f of readdirSync(dir).filter(f => f.endsWith('.txt') && f !== 'liste.txt')) {
  const s = readFileSync(`${dir}/${f}`, 'utf8')
  if (!s.includes('== 6')) continue
  const plan = s.match(/== PLAN (.*)/)![1]
  const ok: Record<string, number> = {}
  for (const m of s.matchAll(/^  ([A-E])\/(suivant|même)\s+(\d+)\/24/gm)) ok[`${m[1]}/${m[2] === 'suivant' ? 's' : 'm'}`] = +m[3]
  const disp: Record<string, number> = {}, enemy: Record<string, number> = {}
  for (const m of s.matchAll(/^  ([A-E])\/(suivant|même)\s+décalage d'une case : (\d+)\/(\d+) cas mortels ; ennemi 1 apparition : (\d+)\/\d+ .*? ennemi immobile : (\d+)/gm)) { const k = `${m[1]}/${m[2] === 'suivant' ? 's' : 'm'}`; disp[k] = +m[3] / +m[4]; enemy[k] = Math.max(+m[5], +m[6]) }
  const vis = [...s.matchAll(/voit\s+(\d+) cases de la zone.*?à 2 PM \d+ \((\d+) cases/g)].map(m => [+m[1], +m[2]])
  const heal = s.match(/A\/suivant    écart max par case (.*?) ; \(ordre, chaîne\) où tous ≤ 5 : (\d+)\/48/)
  const full = Object.entries(ok).filter(([, v]) => v === 24).map(([k]) => k)
  const dA = disp['A/s'] ?? NaN, dN4 = disp['C/s'] ?? disp['D/s'] ?? NaN
  rows.push({ f, plan, full, dA, dAm: disp['A/m'], dN4, enA: enemy['A/s'], enN4: enemy['C/s'], vis: vis.reduce((a, b) => a + b[0], 0), vis2: vis.reduce((a, b) => a + b[1], 0), visMin: Math.min(...vis.map(v => v[1])), heal: heal ? heal[2] : '-' })
}
for (const g of ['g7', 'n2']) {
  const r = rows.filter(x => x.f.startsWith(g)).sort((a, b) => b.full.length - a.full.length || a.dA - b.dA)
  console.log(`== ${g} (${r.length})`)
  for (const x of r.slice(0, 60)) console.log(`  ${x.f.replace('.txt', '')} 24/24:${x.full.length} décalage mortel A/s ${(x.dA * 100).toFixed(0)}% A/m ${x.dAm !== undefined ? (x.dAm * 100).toFixed(0) + '%' : '-'} N4/s ${Number.isNaN(x.dN4) ? '-' : (x.dN4 * 100).toFixed(0) + '%'} ; cases ennemies dangereuses A/s ${x.enA} C/s ${x.enN4 ?? '-'} ; LdV ${x.vis} (sorties 2 PM ${x.vis2}, min ${x.visMin}) ; soins A/s ${x.heal}/48`)
}
