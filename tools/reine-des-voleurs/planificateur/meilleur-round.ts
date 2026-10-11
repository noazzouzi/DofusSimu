// Meilleur round de l'équipe (equipe.ts) en ligne de commande, depuis le début d'une manche du dernier combat du journal
// (tour du premier Crâ) ou depuis le placement d'un nouveau combat.
//   npx tsx tools/reine-des-voleurs/planificateur/meilleur-round.ts [--manche N | --nouveau] [--largeur 4] [--candidats 4]
//   … --placement [--ensembles 3] : meilleur placement des Crâs pour les positions des monstres (placement.ts)
import { data } from './etat'
import { planRound, type TeamPlan, type TeamScore } from './equipe'
import { optimizePlacement } from './placement'
import { journalSnapshot, loadJournal, newFightSnapshot } from './web'

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const round = Number(arg('--manche') ?? 1)
const first = loadJournal()?.rows.turns.find(t => t.round === round)?.player
const snap = process.argv.includes('--nouveau') || first === undefined ? newFightSnapshot() : journalSnapshot(round, first).snap
let res: TeamPlan
if (process.argv.includes('--placement')) {
  const p = optimizePlacement(snap, { sets: Number(arg('--ensembles') ?? 3) })
  console.log(`Potentiel des cases rouges : ${p.potentials.map(c => `${c.cell}:${c.total}${c.safe ? '' : '!'}`).join(' ')}`)
  for (const s of p.sets) console.log(`  ensemble ${s.cells.join(',')} — potentiel ${s.proxy}, round : score ${s.score}, dégâts ${s.damage}`)
  console.log(`Placement retenu : ${p.best.placement.map(x => `${x.name} ${x.cell}`).join(', ')} (${(p.ms / 1000).toFixed(1)} s)`)
  res = p.best
} else res = planRound(snap, { width: Number(arg('--largeur') ?? 4), perCra: Number(arg('--candidats') ?? 4) })
const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`
const fmt = (s: TeamScore) => `score ${s.total} — dégâts ${s.monsterDamage}${s.kills.length ? `, tués : ${s.kills.join(', ')}` : ''}${s.craDeaths.length ? `, Crâs morts : ${s.craDeaths.join(', ')}` : ''}${s.craHpLost ? `, PV Crâs perdus ${s.craHpLost}` : ''}${s.marked.length ? `, marqués : ${s.marked.join(', ')}` : ''}`
console.log(`${snap.source} — ${res.evaluated} suites jouées en ${(res.ms / 1000).toFixed(1)} s`)
console.log(fmt(res.score))
for (const t of res.turns) {
  const p = t.plan
  const steps = p ? p.steps.map(s => (s.kind === 'move' ? `→${s.path.at(-1)}` : `${spellName(s.spell)}@${s.cell}`)).join(' ; ') : '(passe)'
  console.log(`  ${t.name.padEnd(16)} #${t.rank} ${p ? (p.safe ? 'sûr' : 'NON SÛR') : ''} ${p?.total ?? 0} dmg : ${steps}`)
}
console.log('Déroulé :')
for (const s of res.summaries) console.log(`  M${s.round} ${s.name.padEnd(20)} ${s.actions.join(' ; ') || '(rien)'} — fin ${s.endCell}${s.alive ? '' : ' (mort)'}`)
for (const a of res.alternatives) console.log(`alt : ${fmt(a.score)} — rangs ${a.turns.map(t => t.rank).join('')}`)
