// Résumé de par-sort.json : par monstre, meilleurs sorts au PA (régime établi, moteur) et meilleur élément ; tableau
// compact « sort × monstre » (dégâts moyens par lancer, critique pondéré).
import { readFileSync, writeFileSync } from 'node:fs'
import { TARGETS, fmt, pad, lpad } from './lib'
import { SUR, ZONE, POUSSE, INTERDIT } from './categories'
import { persImmediate } from './rotlib'

interface Row { spellId: number; name: string; pair: number; variant: number; ap: number; target: string; targetId: number; calc: number; first: number; steadyPerCast: number; castsPerTurn: number; steadyPerTurn: number; elements: string; critPct: number }
const rows = JSON.parse(readFileSync(new URL('./par-sort.json', import.meta.url), 'utf8')) as Row[]
const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
const cat = (id: number) => (SUR.has(id) ? 'sûr' : ZONE.has(id) ? 'zone' : POUSSE.has(id) ? 'pousse' : INTERDIT.has(id) ? 'INTERDIT' : '')
// Persécutrice : 1er coup seul (2e coup seulement si la cible n'est plus en LdV au tour suivant)
const val = (r: Row) => (r.spellId === 32433 ? persImmediate(TARGETS.find(t => t.id === r.targetId)!) : r.steadyPerCast)
const spells = [...new Map(rows.map(r => [r.spellId, r])).values()].filter(r => rows.some(x => x.spellId === r.spellId && x.steadyPerCast > 0))
log('Dégâts moyens par LANCER (moteur, régime établi, critique pondéré, à distance) — Reine ×1 (sans bombe ni Représailles)')
log(`${pad('sort', 26)} ${pad('élt', 6)} PA ${pad('cat.', 8)} ${TARGETS.map(t => lpad(t.short, 7)).join('')}  lancers/tour`)
for (const s of spells.sort((a, b) => a.pair - b.pair || a.variant - b.variant)) {
  const cells = TARGETS.map(t => { const r = rows.find(x => x.spellId === s.spellId && x.targetId === t.id)!; return lpad(fmt(val(r)), 7) })
  const r0 = rows.find(x => x.spellId === s.spellId)!
  log(`${pad(`P${s.pair}${s.variant ? 'v' : 'b'} ${s.name}`, 26)} ${pad(s.elements || '?', 6)} ${s.ap}  ${pad(cat(s.spellId), 8)} ${cells.join('')}  ${r0.castsPerTurn.toFixed(1)}`)
}
log('\nMeilleurs sorts par monstre (dégâts par PA au régime établi ; sûrs = cible unique) :')
for (const t of TARGETS) {
  const rs = rows.filter(r => r.targetId === t.id && r.steadyPerCast > 0).map(r => ({ r, v: val(r), perAp: val(r) / r.ap }))
  rs.sort((a, b) => b.perAp - a.perAp)
  const top = rs.slice(0, 8).map(x => `${x.r.name} ${fmt(x.v)} (${fmt(x.perAp)}/PA, ${cat(x.r.spellId)})`)
  const byEl = new Map<string, number>()
  for (const x of rs) { const e = x.r.elements; byEl.set(e, Math.max(byEl.get(e) ?? 0, x.perAp)) }
  log(`  ${t.name} : ${top.join(' ; ')}`)
  log(`     meilleur dégât/PA par élément : ${[...byEl].sort((a, b) => b[1] - a[1]).map(([e, v]) => `${e} ${fmt(v)}`).join(' > ')}`)
}
writeFileSync(new URL('./resume-sorts.txt', import.meta.url), out.join('\n') + '\n')
