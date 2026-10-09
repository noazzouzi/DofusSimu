// Meilleure rotation d'UN Crâ (12 PA, cycle de 2 tours) contre chaque monstre, selon la distance et l'alignement,
// les PM dépensés avant de tirer, et trois jeux de sorts :
//   libre  : n'importe quel sort (une variante par paire, choisie au mieux pour CE monstre) ;
//   zones  : sorts sûrs + zones touchant les alliés (si aucun allié/bombe dans la zone) ;
//   strict : sorts sûrs seulement (cible unique, aucun déplacement d'allié ni du lanceur).
// Aucune limite d'équipe ici (Dévorante 4/tour, Pluie 2/tour… : voir equipe.ts). Mesures moteur (rotlib.ts).
import { writeFileSync } from 'node:fs'
import { ALL_SPELLS, TARGETS, fmt, inLine, offLine, pad, lpad, type Geom } from './lib'
import { bestCycle } from './rotlib'
import { ofMode } from './categories'

const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
const GEOMS: [string, Geom][] = [
  ...[2, 3, 4, 5, 6, 7, 8, 10].map(d => [`L${d}`, inLine(d)] as [string, Geom]),
  ...[3, 4, 5, 6, 7, 8, 10].map(d => [`H${d}`, offLine(d)] as [string, Geom]),
]
const MODES = ['libre', 'zones', 'strict'] as const
const json: unknown[] = []
const t0 = Date.now()
for (const t of TARGETS) {
  log(`\n=== ${t.name} (${t.id}, grade ${t.grade}) — DPT d'un Crâ (dégâts moyens par tour, cycle de 2 tours, critique pondéré)`)
  log(`  géométrie : L = cible EN LIGNE à d cases, H = hors ligne (décalée d'une colonne) ; PM = PM dépensés avant de tirer`)
  log(`  ${pad('mode', 8)} PM | ${GEOMS.map(([n]) => lpad(n, 6)).join('')}`)
  for (const mode of MODES) {
    for (const mp of [0, 2]) {
      const row: string[] = []
      for (const [gn, g] of GEOMS) {
        const r = bestCycle(t, g, { allowed: ofMode(mode, ALL_SPELLS), mpUsed: mp })
        row.push(lpad(fmt(r.dpt), 6))
        json.push({ target: t.name, targetId: t.id, geom: gn, mode, mpUsed: mp, dpt: r.dpt, label: r.label, turnA: r.turnA, turnB: r.turnB, casts: [...r.casts] })
      }
      log(`  ${pad(mode, 8)} ${mp}  | ${row.join('')}`)
    }
  }
  for (const [gn, g] of [['L5', inLine(5)], ['H5', offLine(5)], ['L8', inLine(8)], ['H3', offLine(3)]] as [string, Geom][]) {
    for (const mode of MODES) {
      for (const mp of [0, 2]) {
        const r = bestCycle(t, g, { allowed: ofMode(mode, ALL_SPELLS), mpUsed: mp })
        log(`  ${gn} ${pad(mode, 6)} PM${mp} ${lpad(fmt(r.dpt), 6)} : ${r.label}`)
      }
    }
  }
}
log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`)
writeFileSync(new URL('./rotations.json', import.meta.url), JSON.stringify(json))
writeFileSync(new URL('./rotations.txt', import.meta.url), out.join('\n') + '\n')
