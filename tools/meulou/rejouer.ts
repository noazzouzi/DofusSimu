// Rejoue les tours du Sacrieur d'un donjon du Meulou enregistré (MeulouMain.lua, joué à la main, ou MeulouCombat.lua) :
// pour chacun de ses tours, l'état du journal au début du tour, le plan du planificateur actuel (planificateur.ts) et ce
// qui a été joué. Sert à régler la stratégie sur les combats joués.
//
//   npx tsx tools/meulou/rejouer.ts [--fichier data/fightlogs/…/session-….jsonl] [--perso Larry-Kind-jumploise]
//                                   [--combat n] [--manche m] [--variantes "Décimation,Afflux,Entaille"]
// Défaut : le dernier fichier de data/fightlogs qui contient le journal du Sacrieur, tous ses combats.
import { join } from 'node:path'
import { MSG, fightRange, loadStream, rebuild } from '../fightlog/rejeu'
import { appliquerVariantes, lireVariantes } from '../feca/variantes'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { spellListOf, type Row } from '../reine-des-voleurs/planificateur/journal'
import { etatCombat } from '../ventre-de-la-baleine/etat'
import { moteurDuTour } from '../ventre-de-la-baleine/moteur'
import { decrirePas } from '../ventre-de-la-baleine/planificateur'
import { knownSpellLists } from '../ventre-de-la-baleine/rejouer'
import { bilanMeulou, fightMap, fightStarts, latestSessionWith } from './bilan'
import { SACRIEUR, nomCarte } from './meulou'
import { planTourSacri } from './planificateur'

/** Lignes qui ouvrent le tour de `gameId` dans la manche `round` du combat [from, to[, et fin de son début de tour. */
function turnRows(rows: Row[], from: number, to: number, gameId: number, round: number): { start: number; ready: number } | undefined {
  let r = 0
  for (let i = from; i < to; i++) {
    const x = rows[i]
    if (x.k !== 'm') continue
    if (x.n === MSG.round) r = x.d?.fxjj ?? r
    if (x.n !== MSG.turnStart || x.d?.fxjr !== gameId || r !== round) continue
    let j = i + 1
    for (; j < to; j++) {
      const y = rows[j]
      if (y.k !== 'm') continue
      if (y.n === MSG.seqStart || y.n === MSG.move || y.n === MSG.turnEnd) break
    }
    return { start: i, ready: j }
  }
  return undefined
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('meulou/rejouer.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const perso = arg('--perso') ?? SACRIEUR
  const file = arg('--fichier') ?? latestSessionWith(join(process.cwd(), 'data', 'fightlogs'), perso)
  const { rows } = loadStream(file, perso)
  let list = spellListOf(rows) ?? knownSpellLists()[perso] ?? []
  list = appliquerVariantes(list, arg('--variantes')?.split(',') ?? lireVariantes(join('data', 'fightlogs', 'variantes.json'))[perso] ?? [])
  const name = (id: number) => data.spell(id)?.name ?? String(id)
  console.log(`${file} — ${perso}, sorts : ${list.map(s => `${name(s.spellId)} ${s.grade}`).join(', ')}`)
  const fights = arg('--combat') !== undefined ? [Number(arg('--combat'))] : fightStarts(rows)
  const onlyRound = arg('--manche') ? Number(arg('--manche')) : undefined
  let total = 0
  let turns = 0
  for (const k of fights) {
    const mapId = fightMap(rows, k)
    let b
    try {
      b = bilanMeulou(rebuild(rows, { which: k, mapId }), k, perso)
    } catch (err) {
      console.log(`\nCombat ${k} : ${(err as Error).message}`)
      continue
    }
    const { from, to } = fightRange(rows, k)
    const sacri = rebuild(rows, { which: k, mapId }).fighters.find(f => f.name === perso)
    if (!sacri) continue
    console.log(`\n═══ Combat ${k} — ${mapId} (${mapId ? nomCarte(mapId) : '?'}), ${b.rounds} manches`)
    for (const t of b.turns) {
      if (t.name !== perso || t.notes.includes('(mort)')) continue
      if (onlyRound !== undefined && t.round !== onlyRound) continue
      const at = turnRows(rows, from, to, sacri.gameId, t.round)
      if (!at) continue
      const st = etatCombat(rows.slice(0, at.ready), { mapId })
      const me = st.res.fighters.find(f => f.name === perso)
      if (!me || st.current !== me.id) {
        console.log(`M${t.round} : tour introuvable dans l'état`)
        continue
      }
      const mo = moteurDuTour(st, me.id, { spells: { [perso]: list } })
      const res = planTourSacri(st, mo)
      total += res.ms
      turns++
      const plan = res.plans[0]
      const pv = mo.fight.fighters[mo.me]
      console.log(`M${t.round} (case ${t.startCell}, ${pv.ap} PA, ${pv.mp} PM, ${Math.round(pv.hp)}/${pv.maxHp} PV) — ${res.ms} ms, ${res.evaluated} lancers`)
      if (plan) {
        console.log(`   plan  : ${plan.steps.map(x => decrirePas(x, name)).join(', ') || 'rien'} → fin ${plan.endCell} (note ${plan.score} : ` +
          `${Object.entries(plan.parts).filter(([, v]) => v).map(([kk, v]) => `${kk} ${v}`).join(', ')}) — ${plan.notes.join(' ; ')}`)
      } else console.log('   plan  : aucun')
      const joue = t.casts.map(c => `${c.spell}${c.crit ? ' (CC)' : ''} → ${c.cible} (${c.degats.reduce((x, d) => x + d.montant, 0)})`)
      console.log(`   joué  : ${[...t.notes.filter(n => n.startsWith('marche')), ...joue].join(', ') || 'rien'} → fin ${t.endCell}`)
    }
  }
  if (turns) console.log(`\n${turns} tour(s), ${Math.round(total / turns)} ms par plan en moyenne`)
}
