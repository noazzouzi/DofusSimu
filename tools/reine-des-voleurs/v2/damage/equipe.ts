// Choix des VARIANTES de l'équipe (22 choix 0/1, mêmes pour les 4 Crâs) par descente coordonnée, sur le temps total de
// mise à mort des 5 vagues à 4 joueurs, avec les limites d'ÉQUIPE (Dévorante 4 lancers/tour → 1 par Crâ ; Pluie de
// Flèches 2/tour → 2 Crâs sur 4 ; Fulminante 1/tour → 1 Crâ sur 4) et le coût de Représailles (3 PA, un Crâ par tour,
// tant que la Reine vit). Mesures moteur (rotlib.ts), géométries L5 et H5 (cible à 5 cases, en ligne / hors ligne), PM
// dépensés avant de tirer 0 et 2 (moyenne). Deux jeux de sorts : « strict » (cible unique seulement) et « zones » (zones
// alliées permises quand la zone est vide d'alliés) ; score = moyenne des deux.
import { writeFileSync } from 'node:fs'
import { ALL_SPELLS, PAIRS, TARGETS, fmt, inLine, nameOf, offLine, pad, lpad, type Geom } from './lib'
import { bestCycle, DEVO, PLUIE, FULMI, type Extra } from './rotlib'
import { ofMode } from './categories'

const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
export const COUNT = [1, 3, 4, 4, 3, 5]
export const HP = [15000, 6600, 6600, 3300, 6600, 6600]
const GEOMS: Geom[] = [inLine(5), offLine(5)]
const MPS = [0, 2]

export function spellsOf(v: readonly (0 | 1)[]): number[] {
  return PAIRS.map((p, i) => p[v[i]])
}
/** DPT d'équipe (4 Crâs) contre la cible i, moyenne géométries × PM, mode donné, coût de Représailles compris. */
export function teamDpt(v: readonly (0 | 1)[], i: number, mode: 'strict' | 'zones', opts: { reprCost?: boolean; extra?: Extra; geoms?: Geom[]; mps?: number[] } = {}): number {
  const allowed = new Set([...ofMode(mode, ALL_SPELLS)].filter(s => spellsOf(v).includes(s)))
  const t = TARGETS[i]
  const hasRepr = allowed.has(32472)
  let sum = 0, n = 0
  for (const g of opts.geoms ?? GEOMS) for (const mp of opts.mps ?? MPS) {
    const dpt = (caps: Map<number, number>, ap = 12) => bestCycle(t, g, { allowed, mpUsed: mp, caps, ap, extra: opts.extra }).dpt
    // limites d'équipe : Dévorante 1 par Crâ ; Pluie : 2 Crâs sur 4 ; Fulminante : 1 Crâ sur 4
    const c = (pluie: number, fulmi: number) => new Map([[DEVO, 1], [PLUIE, pluie], [FULMI, fulmi]])
    const four = [c(1, 1), c(1, 0), c(0, 0), c(0, 0)]
    let team = 0
    four.forEach((caps, k) => {
      // le Crâ 4 lance Représailles (3 PA) ce tour — la rotation tourne : en moyenne un Crâ sur quatre a 9 PA
      const ap = (opts.reprCost ?? true) && hasRepr && k === 3 ? 9 : 12
      team += dpt(caps, ap)
    })
    sum += team
    n++
  }
  return sum / n
}
/** Temps total (tours de jeu) pour tuer les monstres des 5 vagues, Reine ×1,10 (Représailles) × 0,677 (bombes). */
export function totalTime(v: readonly (0 | 1)[], mode: 'strict' | 'zones', extra?: Extra): { total: number; per: number[] } {
  const per = TARGETS.map((_, i) => {
    let d = teamDpt(v, i, mode, { extra })
    if (i === 0) d *= 1.1 * 0.677
    return d
  })
  const total = per.reduce((s, d, i) => s + (COUNT[i] * HP[i]) / Math.max(1, d), 0)
  return { total, per }
}
export const score = (v: readonly (0 | 1)[]) => (totalTime(v, 'strict').total + totalTime(v, 'zones').total) / 2

if (import.meta.url === `file://${process.argv[1]}`) {
  // Vecteur de départ (README §2.5 + utilités) : P1 Recul, P3 Évasive, P6 Tir Perçant, P10 Tyrannique, P16 Représailles,
  // P18 Jugement, P20 Boomerang, P22 Sentinelle…
  let v: (0 | 1)[] = [0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1]
  // Paires décidées par les DÉGÂTS (les autres le sont par la formation et l'utilité, voir le rapport).
  const FREE = [1, 6, 7, 9, 12, 13, 14, 17, 18, 19, 20] // indices 0-based : P2, P7, P8, P10, P13, P14, P15, P18, P19, P20, P21
  const t0 = Date.now()
  let best = score(v)
  log(`départ ${JSON.stringify(v)} : temps total ${best.toFixed(2)} tours de jeu (moyenne strict/zones)`)
  for (let sweep = 0; sweep < 2; sweep++) {
    let improved = false
    for (const k of FREE) {
      const w = v.slice() as (0 | 1)[]
      w[k] = (1 - w[k]) as 0 | 1
      const s = score(w)
      log(`  P${k + 1} ${nameOf(PAIRS[k][v[k]])} → ${nameOf(PAIRS[k][w[k]])} : ${s.toFixed(2)} (${s < best ? 'MIEUX' : 'non'}) [${((Date.now() - t0) / 1000).toFixed(0)} s]`)
      if (s < best - 1e-6) { v = w; best = s; improved = true }
    }
    if (!improved) break
  }
  log(`\nretenu ${JSON.stringify(v)} : ${best.toFixed(2)}`)
  for (const mode of ['strict', 'zones'] as const) {
    const r = totalTime(v, mode)
    log(`  ${pad(mode, 7)} : ${TARGETS.map((t, i) => `${t.name} ${fmt(r.per[i])}`).join(' · ')} — temps total ${r.total.toFixed(2)}`)
  }
  log(PAIRS.map((p, i) => `  P${i + 1} ${v[i]} ${nameOf(p[v[i]])}`).join('\n'))
  writeFileSync(new URL('./equipe.txt', import.meta.url), out.join('\n') + '\n')
  writeFileSync(new URL('./equipe.json', import.meta.url), JSON.stringify({ v, best }))
  void lpad
}
