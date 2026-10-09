// Tableau final par monstre avec le vecteur de variantes retenu (argument JSON) :
//  - DPT d'UN Crâ (cycle de 2 tours, moteur) et sa rotation, en formation stricte et avec zones, aux géométries de
//    référence (cible à 5 cases hors ligne / en ligne ; 0 ou 2 PM dépensés avant de tirer) ;
//  - DPT de l'ÉQUIPE mesuré au moteur avec les 4 Crâs EN MÊME TEMPS (teambench.ts) : limites d'équipe (Dévorante
//    1/Crâ, Pluie 2 Crâs, Fulminante 1 Crâ), Représailles à tour de rôle (3 PA ; sur la Reine : ×110 % et Pesanteur ;
//    sur les autres cibles : 3 PA perdus par tour de jeu tant que la Reine vit) ;
//  - tours pour tuer : tours de Crâ (un Crâ seul) et tours de jeu à 4 ; Reine ×0,9ⁿ (n bombes vivantes, 0 à 4) et
//    ×0,677 (moyenne de la formation, README §2.1).
import { writeFileSync } from 'node:fs'
import { ALL_SPELLS, PAIRS, TARGETS, fmt, inLine, nameOf, offLine, pad, lpad, type Geom, type TurnPlan } from './lib'
import { bestCycle, order, DEVO, PLUIE, FULMI, TP, type CycleResult } from './rotlib'
import { ofMode } from './categories'
import { teamBench } from './teambench'

const v: (0 | 1)[] = JSON.parse(process.argv[2])
const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
const spells = PAIRS.map((p, i) => p[v[i]])
const HP = [15000, 6600, 6600, 3300, 6600, 6600]
const REF: [string, Geom, boolean, number][] = [['H5', offLine(5), false, 5], ['L5', inLine(5), true, 5], ['H7', offLine(7), false, 7]]
const json: unknown[] = []
const short = (r: CycleResult) => r.label.replace(/Flèche /g, '').replace(/Flèches /g, '')
log(`Vecteur retenu ${JSON.stringify(v)}`)
log(spells.map((s, i) => `P${i + 1}=${v[i]} ${nameOf(s)}`).join(' ; '))

for (const mode of ['strict', 'zones'] as const) {
  const allowed = new Set([...ofMode(mode, ALL_SPELLS)].filter(s => spells.includes(s)))
  log(`\n################ MODE ${mode.toUpperCase()} ################`)
  for (const [i, t] of TARGETS.entries()) {
    log(`\n=== ${t.name} (${fmt(HP[i])} PV)`)
    for (const [gn, g, aligned, dist] of REF) {
      for (const mp of [0, 2]) {
        const caps = (pl: number, fu: number) => new Map([[DEVO, 1], [PLUIE, pl], [FULMI, fu]])
        const capsOf = [caps(1, 1), caps(1, 0), caps(0, 0), caps(0, 0)]
        const one = bestCycle(t, g, { allowed, mpUsed: mp })
        const cyc = capsOf.map(c => bestCycle(t, g, { allowed, mpUsed: mp, caps: c }))
        // plans moteur : Crâ k joue A/B en alternance ; au tour de jeu r, le Crâ (r−1)%4 lance d'abord Représailles
        const planFor = (k: number, r: number): TurnPlan => {
          const c = cyc[k]
          const vals = new Map<number, number>()
          const raw = (r % 2 === 1 ? c.turnA : c.turnB).map(s => ({ spell: s, on: s === TP ? ('self' as const) : undefined }))
          if ((r - 1) % 4 === k && allowed.has(32472)) {
            if (i === 0) return [{ spell: 32472 }, ...raw]
            // autre cible : Représailles part sur la Reine (hors banc) → 3 PA de moins ce tour
            return [{ spell: -1 } as never, ...raw]
          }
          void vals
          return raw
        }
        const apOf = (k: number, r: number) => ((r - 1) % 4 === k && allowed.has(32472) && i !== 0 ? 9 : 12)
        const team = teamBench((k, r) => planFor(k, r).filter(s => s.spell !== -1), t, aligned, { d: dist, mpUsed: mp, apOf })
        const team0 = teamBench((k, r) => planFor(k, r).filter(s => s.spell !== -1), t, aligned, { d: dist, mpUsed: mp, apOf, warm: 0, rounds: 3 })
        // sans limite d'équipe (hypothèse : « global » = par Crâ) : chaque Crâ joue son meilleur cycle libre
        const planFree = (k: number, r: number): TurnPlan => {
          const raw = (r % 2 === 1 ? one.turnA : one.turnB).map(s => ({ spell: s, on: s === TP ? ('self' as const) : undefined }))
          if ((r - 1) % 4 === k && allowed.has(32472) && i === 0) return [{ spell: 32472 }, ...raw]
          return raw
        }
        const teamFree = teamBench(planFree, t, aligned, { d: dist, mpUsed: mp, apOf })
        const hidden = bestCycle(t, g, { allowed, mpUsed: mp, persMode: 'cache' })
        const crâTurns = HP[i] / one.dpt
        const rounds = HP[i] / team.mean
        let extra = ''
        if (i === 0) extra = ` | Reine ×0,9ⁿ, n = 0..4 : ${[0, 1, 2, 3, 4].map(n => (HP[i] / (team.mean * 0.9 ** n)).toFixed(1)).join(' / ')} tours de jeu ; ×0,677 (formation) : ${(HP[i] / (team.mean * 0.677)).toFixed(1)}`
        log(`  ${gn} PM${mp} : 1 Crâ ${lpad(fmt(one.dpt), 5)}/tour (${crâTurns.toFixed(1)} tours de Crâ) | équipe moteur ${lpad(fmt(team.mean), 6)}/tour de jeu (Crâs ${team.byCra.map(x => fmt(x)).join('/')}) → ${rounds.toFixed(2)} tours de jeu ; 1er/2e/3e tour ${team0.perRound.map(x => fmt(x)).join('/')}${extra}`)
        log(`      rotation (1 Crâ, sans limite d'équipe) : ${short(one)}`)
        log(`      rotations moteur de l'équipe (Crâ 1 : Pluie + Fulminante permises ; Crâ 2 : Pluie ; tous : 1 Dévorante/tour) : ${cyc.map((c, k) => `Crâ${k + 1} ${fmt(c.dpt)}`).join(' · ')} ; équipe SANS limite d'équipe ${fmt(teamFree.mean)}/tour de jeu (${(HP[i] / teamFree.mean).toFixed(2)} tours)`)
        if (Math.abs(hidden.dpt - one.dpt) > 1) log(`      si Persécutrice part cachée (2e coup) : 1 Crâ ${fmt(hidden.dpt)}/tour : ${short(hidden)}`)
        if (team.refused.size) log(`      refus moteur (par tour mesuré) : ${[...team.refused].map(([k, n]) => `${k}×${n}`).join(', ')}`)
        json.push({ mode, target: t.name, geom: gn, mp, teamFree: teamFree.mean, hidden: hidden.dpt, hiddenLabel: hidden.label, one: one.dpt, oneLabel: one.label, team: team.mean, byCra: team.byCra, rounds, craTurns: crâTurns, first: team0.perRound, cycles: cyc.map(c => c.label) })
      }
    }
  }
}
writeFileSync(new URL('./final.txt', import.meta.url), out.join('\n') + '\n')
writeFileSync(new URL('./final.json', import.meta.url), JSON.stringify(json, null, 1))
void order
void pad
