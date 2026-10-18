// Le planificateur sur un combat enregistré : pour chaque tour de Crâ, l'état exact au début du tour (journal), le plan
// proposé et ce qui a été joué. Sert à vérifier l'algorithme avant de le laisser jouer.
//
//   npx tsx tools/ventre-de-la-baleine/rejouer.ts [--fichier data/fightlogs/…/session-….jsonl] [--combat -1]
//                                                 [--manche 2] [--joueur Java-Springboot] [--carte 140771332] [--perso X]
// Défaut : journaux des 4 personnages fusionnés (comme le serveur), dernier combat contre des Krobes de la session ;
// --combat n : n-ième (0 = le premier). --perso : le journal de ce personnage seul (sans les tours de ce personnage si
// c'est un journal de BaleineCombat.lua).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MSG, loadStream } from '../fightlog/rejeu'
import { data } from '../reine-des-voleurs/planificateur/etat'
import type { Row } from '../reine-des-voleurs/planificateur/journal'
import { spellListOf } from '../reine-des-voleurs/planificateur/journal'
import { baleineFightsOfFile, bilanCombat } from './bilan'
import { etatCombat } from './etat'
import { moteurDuTour } from './moteur'
import { decrirePas, planTourBaleine } from './planificateur'

/** Listes de sorts connues de chaque Crâ (journal du personnage, sinon data/fightlogs/sorts-connus.json). */
export function knownSpellLists(root = process.cwd()): Record<string, { spellId: number; grade: number }[]> {
  const file = join(root, 'data', 'fightlogs', 'sorts-connus.json')
  if (!existsSync(file)) return {}
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { spells: { spellId: number; grade: number }[] }>
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.spells]))
}

/** Index de la ligne qui ouvre le tour de `gameId` dans la manche `round`, et fin de son début de tour (avant sa 1re action). */
function turnRows(rows: Row[], gameId: number, round: number): { start: number; ready: number } | undefined {
  let r = 0
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i]
    if (x.k !== 'm') continue
    if (x.n === MSG.round) r = x.d?.fxjj ?? r
    if (x.n !== MSG.turnStart || x.d?.fxjr !== gameId || r !== round) continue
    let j = i + 1
    for (; j < rows.length; j++) {
      const y = rows[j]
      if (y.k !== 'm') continue
      if (y.n === MSG.seqStart || y.n === MSG.move || y.n === MSG.turnEnd) break
    }
    return { start: i, ready: j }
  }
  return undefined
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ventre-de-la-baleine/rejouer.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const file = arg('--fichier') ?? 'data/fightlogs/2026-10-14/session-12-04-36.jsonl'
  const spells = knownSpellLists()
  let rows: Row[]
  let fightMap: number | undefined
  if (arg('--perso')) {
    const one = loadStream(file, arg('--perso'))
    rows = one.rows
    const own = spellListOf(rows)
    if (own) spells[one.character] = own
  } else {
    const fights = baleineFightsOfFile(file)
    const k = Number(arg('--combat') ?? -1)
    const f = fights.at(k)
    if (!f) throw new Error(`${file} : combat ${k} introuvable (${fights.length} combat(s) contre des Krobes)`)
    rows = f.rows
    fightMap = f.mapId
  }
  const b = bilanCombat(rows, -1, { mapId: fightMap })
  const mapId = Number(arg('--carte') ?? b.mapId)
  const onlyRound = arg('--manche') ? Number(arg('--manche')) : undefined
  const onlyWho = arg('--joueur')
  const st0 = etatCombat(rows, { mapId })
  const name = (id: number) => data.spell(id)?.name ?? String(id)
  console.log(`${file} — ${b.rounds} manches, carte ${mapId}`)
  for (const t of b.turns) {
    if (t.kind !== 'player' || t.dead) continue
    if (onlyRound !== undefined && t.round !== onlyRound) continue
    if (onlyWho && t.name !== onlyWho) continue
    const real = st0.res.fighters[t.fighter]
    const at = turnRows(rows, real.gameId, t.round)
    if (!at) continue
    const st = etatCombat(rows.slice(0, at.ready), { mapId })
    if (st.current !== t.fighter) {
      console.log(`M${t.round} ${t.name} : tour introuvable dans l'état (${st.current})`)
      continue
    }
    const mo = moteurDuTour(st, t.fighter, { ap: t.ap, mp: t.mp, spells })
    const res = planTourBaleine(st, mo)
    const plan = res.plans[0]
    const played = t.casts.map(c => `${c.spell}@${c.cell}`).join(', ')
    console.log(`\nM${t.round} ${t.name} (${t.startCell}, ${t.ap} PA, ${t.mp} PM) — ${res.ms} ms, ${res.evaluated} lancers essayés`)
    if (!plan) {
      console.log('   plan : aucun')
    } else {
      console.log(`   plan  : ${plan.steps.map(x => decrirePas(x, name)).join(', ')} → fin ${plan.endCell} (note ${plan.score} : ${Object.entries(plan.parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')})${plan.notes.length ? ' ⚠ ' + plan.notes.join(' ; ') : ''}`)
    }
    console.log(`   joué  : ${played || 'aucun sort'} → fin ${t.endCell} (${t.damageDealt} dégâts à la Malamibe)`)
  }
}
