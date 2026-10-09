// Valeur des buffs et des sorts de soutien, mesurée au moteur (rotations d'un Crâ, rotlib.ts), avec le vecteur de
// variantes donné en argument (JSON) : Tirs Puissants, Tir Perçant, Sentinelle (malus par PM), Acuité Absolue,
// Balise Tactique (+40 Puissance par ennemi : +80 mesuré au moteur à 3+ ennemis, +160 si 4 ennemis comptent comme le
// disent les données), Représailles (×110 % sur la Reine pour toute l'équipe).
import { writeFileSync } from 'node:fs'
import { ALL_SPELLS, PAIRS, TARGETS, fmt, inLine, offLine, pad, type Geom } from './lib'
import { bestCycle, TP, TPERC, type Extra } from './rotlib'
import { ofMode } from './categories'

const v: (0 | 1)[] = process.argv[2] ? JSON.parse(process.argv[2]) : [0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1]
const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
const spells = PAIRS.map((p, i) => p[v[i]])
const GEOMS: [string, Geom][] = [['L5', inLine(5)], ['H5', offLine(5)]]
const pct = (a: number, b: number) => `${a >= b ? '+' : ''}${(((a / b) - 1) * 100).toFixed(1)} %`
log(`Vecteur ${JSON.stringify(v)}`)
for (const mode of ['strict', 'zones'] as const) {
  const allowed = new Set([...ofMode(mode, ALL_SPELLS)].filter(s => spells.includes(s)))
  const without = (s: number) => new Set([...allowed].filter(x => x !== s))
  log(`\n=== mode ${mode} (DPT d'un Crâ, moyenne L5/H5 ; PM dépensés 0 puis 2)`)
  for (const mp of [0, 2]) {
    log(` -- PM dépensés avant de tirer : ${mp}`)
    for (const t of TARGETS) {
      const avg = (f: (g: Geom) => number) => GEOMS.reduce((s, [, g]) => s + f(g), 0) / GEOMS.length
      const D = (g: Geom, o: { ap?: number; extra?: Extra; allowed?: Set<number> } = {}) => bestCycle(t, g, { allowed: o.allowed ?? allowed, mpUsed: mp, ap: o.ap, extra: o.extra }).dpt
      const base = avg(g => D(g))
      const noTP = avg(g => D(g, { allowed: without(TP) }))
      const noTPerc = avg(g => D(g, { allowed: without(TPERC) }))
      // Sentinelle : 2 PA au tour de pose ; bonus 20 − 2×PM au tour 1, 20 − 6×PM au tour 2 ; relance 5 → cycle de 5 tours
      const b1 = 20 - 2 * mp, b2 = Math.max(0, 20 - 6 * mp)
      const sent = avg(g => (D(g, { ap: 10, extra: { rangedDamagePct: b1 } }) + D(g, { extra: { rangedDamagePct: b2 } }) + 3 * D(g)) / 5)
      // Acuité Absolue : 2 PA, +15 % CC 1 tour, relance 4 (cycle de 4 tours)
      const acu = avg(g => (D(g, { ap: 10, extra: { critical: 15 } }) + 3 * D(g)) / 4)
      // Balise Tactique : 1 PA un tour sur deux, Puissance tenue en permanence
      const bal80 = avg(g => (D(g, { ap: 11, extra: { power: 80 } }) + D(g, { extra: { power: 80 } })) / 2)
      const bal160 = avg(g => (D(g, { ap: 11, extra: { power: 160 } }) + D(g, { extra: { power: 160 } })) / 2)
      log(`  ${pad(t.name, 13)} base ${fmt(base)} | sans Tirs Puissants ${pct(noTP, base)} | sans Tir Perçant ${pct(noTPerc, base)} | Sentinelle ${pct(sent, base)} | Acuité ${pct(acu, base)} | Balise Tactique +80 Pui ${pct(bal80, base)}, +160 Pui ${pct(bal160, base)}`)
    }
  }
}
writeFileSync(new URL('./buffs.txt', import.meta.url), out.join('\n') + '\n')
