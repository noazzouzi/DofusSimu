import { readFileSync, readdirSync } from 'node:fs'
const dir = 'tools/reine-des-voleurs/v2/search/rob'
const rows: any[] = []
for (const f of readdirSync(dir).filter(f => /^(g7|n2)-.*\.txt$/.test(f))) {
  const s = readFileSync(`${dir}/${f}`, 'utf8')
  if (!s.includes('== 6')) continue
  const ok: Record<string, number> = {}
  for (const m of s.matchAll(/^  ([A-E])\/(suivant|même)\s+(\d+)\/24/gm)) ok[`${m[1]}/${m[2] === 'suivant' ? 's' : 'm'}`] = +m[3]
  let dSum = 0, dN = 0, enMax = 0, dTot = 0, dBad = 0
  for (const m of s.matchAll(/^  ([A-E])\/(suivant|même)\s+décalage d'une case : (\d+)\/(\d+) cas mortels ; ennemi 1 apparition : (\d+)\/\d+ .*? ennemi immobile : (\d+)/gm)) {
    const k = `${m[1]}/${m[2] === 'suivant' ? 's' : 'm'}`
    if (ok[k] !== 24) continue
    dSum += +m[3] / +m[4]; dN++; dBad += +m[3]; dTot += +m[4]; enMax = Math.max(enMax, +m[5], +m[6])
  }
  const vis = [...s.matchAll(/voit\s+(\d+) cases de la zone.*?à 2 PM \d+ \((\d+) cases/g)].map(m => [+m[1], +m[2]])
  const heal = s.match(/A\/suivant    écart max par case .*? où tous ≤ 5 : (\d+)\/48/)
  const pm = s.match(/== PLAN (.*)/)![1].match(/\((\d+)\)/g)!.map(x => +x.slice(1, -1))
  rows.push({ f: f.replace('.txt', ''), n: Object.values(ok).filter(v => v === 24).length, heal: heal ? +heal[1] : 0, disp: dSum / dN, dispPooled: dBad / dTot, enMax, ldv: vis.reduce((a, b) => a + b[0], 0), ldv2: vis.reduce((a, b) => a + b[1], 0), ldv2min: Math.min(...vis.map(v => v[1])), pm: pm.reduce((a, b) => a + b, 0) })
}
rows.sort((a, b) => b.n - a.n || b.heal - a.heal || a.disp - b.disp)
for (const r of rows.filter(r => !process.env.G || r.f.startsWith(process.env.G)).slice(0, 30)) console.log(`${r.f.padEnd(22)} var ${r.n} soinsA ${r.heal}/48 décalage mortel moyen ${(r.disp * 100).toFixed(0)}% (global ${(r.dispPooled * 100).toFixed(0)}%) cases ennemies ≤ ${r.enMax} LdV ${r.ldv}/${r.ldv2} (min sortie ${r.ldv2min}) PM ${r.pm}`)
