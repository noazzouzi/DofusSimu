// Rejoue les plans d'un Féca seul (plans-*.jsonl du serveur du Féca) avec le planificateur actuel : pour chaque plan
// enregistré, l'état du journal à ce moment-là (session-*.jsonl de la même session), recalé sur l'état que le script
// avait envoyé (champ « etat », enregistré depuis le 2026-10-17 ; avant : la case du Féca seulement), puis le plan
// d'alors et celui d'aujourd'hui. Sert à régler l'algorithme sur les combats joués.
//
//   npx tsx tools/feca/rejouer.ts --plans data/fightlogs/2026-10-17/plans-00-03-04.jsonl [--perso Kaskyzo]
//                                 [--carte 140772356] [--variantes "Giboulée,Ataraxie,Escapade"]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FStep } from '../reine-des-voleurs/planificateur/formation'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { chainsOf, readJsonLines, spellListOf } from '../reine-des-voleurs/planificateur/journal'
import { appliquerEtatDirect, etatCombat, type EtatDirect } from '../ventre-de-la-baleine/etat'
import { moteurDuTour } from '../ventre-de-la-baleine/moteur'
import { decrirePas } from '../ventre-de-la-baleine/planificateur'
import { knownSpellLists } from '../ventre-de-la-baleine/rejouer'
import { planTourFeca } from './planificateur'
import { appliquerVariantes, lireVariantes } from './variantes'

interface PlanRecord {
  at: string
  who: string
  round: number
  cell: number
  ap: number
  mp: number
  score: number
  parts: Record<string, number>
  notes: string[]
  endCell: number
  steps: FStep[]
  etat?: EtatDirect
  carte?: number
  refus?: string[]
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('feca/rejouer.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const plansFile = arg('--plans')
  if (!plansFile) throw new Error('--plans data/fightlogs/<date>/plans-<heure>.jsonl')
  const records = readFileSync(plansFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as PlanRecord)
  const who = arg('--perso') ?? records[0]?.who
  const mine = records.filter(r => r.who === who)
  // Flux du personnage par le nom de ses lots, comme le serveur (le journal d'un script qui joue n'a pas les messages
  // d'identité qui donnent son identifiant).
  const session = plansFile.replace(/plans-([^\\/]+)\.jsonl$/, 'session-$1.jsonl')
  const chain = chainsOf(readJsonLines(session)).find(x => x.c === who)
  if (!chain) throw new Error(`${who} absent de ${session}`)
  const rows = chain.rows
  const character = who
  let spells = spellListOf(rows) ?? knownSpellLists()[character] ?? []
  const declared = arg('--variantes')?.split(',') ?? lireVariantes(join('data', 'fightlogs', 'variantes.json'))[character] ?? []
  spells = appliquerVariantes(spells, declared)
  const name = (id: number) => data.spell(id)?.name ?? String(id)
  const show = (steps: FStep[]) => steps.map(x => decrirePas(x, name)).join(', ') || 'rien'
  const parts = (p: Record<string, number>) => Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')
  console.log(`${plansFile} — ${who}, ${mine.length} plan(s), sorts : ${spells.map(s => name(s.spellId)).join(', ')}`)
  for (const r of mine) {
    const upTo = rows.filter(x => x.at <= r.at)
    const st = etatCombat(upTo, { mapId: r.carte ?? (Number(arg('--carte')) || undefined) })
    const me = st.res.fighters.find(f => f.kind === 'player' && f.name === who)
    if (!me) {
      console.log(`\n${r.at.slice(11, 19)} : ${who} absent du journal`)
      continue
    }
    const etat = r.etat ?? { entites: [], lances: [], tour: 1 }
    const { obstacles } = appliquerEtatDirect(st, me.id, etat)
    const mo = moteurDuTour(st, me.id, { ap: r.ap, mp: r.mp, cell: r.cell, spells: { [character]: spells }, obstacles })
    const res = planTourFeca(st, mo, { forbid: new Set(r.refus ?? []) })
    const plan = res.plans[0]
    const pv = mo.fight.fighters[mo.me]
    console.log(`\n${r.at.slice(11, 19)} M${st.round} — case ${r.cell}, ${r.ap} PA, ${r.mp} PM, ${Math.round(pv.hp)}/${pv.maxHp} PV`)
    console.log(`   alors : ${show(r.steps)} → fin ${r.endCell} (note ${r.score} : ${parts(r.parts)})${r.notes.length ? ' ⚠ ' + r.notes.join(' ; ') : ''}`)
    if (plan) console.log(`   now   : ${show(plan.steps)} → fin ${plan.endCell} (note ${plan.score} : ${parts(plan.parts)}) — ${plan.notes.join(' ; ')} (${res.ms} ms)`)
    else console.log('   now   : aucun plan')
  }
}
