// Scénarios des placements de la Reine des Voleurs : apprendre des combats joués, voir ce qui est appris.
//
//   npm run reine:scenarios -- apprendre <dossier ou session.jsonl>… [--essai]
//       combats des sessions (data/fightlogs/<jour>/session-*.jsonl) ajoutés à la bibliothèque de leur placement
//       (data/reine/scenarios) ; --essai : rien n'est écrit
//   npm run reine:scenarios -- resume [--depuis 2026-10-12] [--detail]
//       par placement : combats appris, situations du scénario, couverture (part des tours qu'un nouveau combat jouerait
//       sans le serveur, estimée en rejouant chaque combat contre le scénario appris des autres) ; --detail : par combat
//   npm run reine:scenarios -- placements
//       placements du registre (data/reine/placements.json) : signature, cases, colonne, combats appris
//   npm run reine:scenarios -- oublier <identifiant de combat (ou son début)>
//       retire un combat de la bibliothèque (combat raté pour une raison extérieure, sorts changés…)
//
// Ensuite : npm run reine:combat (régénère tools/ankabot/ReineCombat.lua avec les scénarios compilés).
import { relative } from 'node:path'
import { learn } from './apprendre'
import { loadLibrary, removeFight, saveLibrary } from './bibliotheque'
import { compilePlacement, coverage } from './compilation'
import { casesOf, colonneOf, loadRegistry, signature } from './placements'

const args = process.argv.slice(2)
const cmd = args[0]
const opt = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const flag = (k: string) => args.includes(k)
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—')

function resume(): void {
  const reg = loadRegistry()
  const depuis = opt('--depuis')
  if (!reg.placements.length) console.log('Aucun placement dans data/reine/placements.json.')
  for (const p of reg.placements) {
    const lib = loadLibrary(p.nom)
    const c = compilePlacement(reg, p, lib, { depuis })
    const cov = coverage(reg, p, lib, { depuis })
    const st = c.stats
    console.log(`\n${p.nom}${p.auto ? ' (créé par l’apprentissage : à renommer)' : ''} — monstres en ${signature(p.monstres)}`)
    console.log(`  ${st.combats} combat(s) appris${depuis ? ` depuis le ${depuis}` : ''}, ${st.victoires} gagné(s) ; ${st.branches} situation(s) dans le scénario`)
    const ec = Object.entries(st.ecartees)
    if (ec.length) console.log(`  tours écartés : ${ec.map(([k, v]) => `${v} ${k}`).join(', ')}`)
    if (cov.tours) {
      const m = cov.parCombat.map(x => x.manches).sort((a, b) => a - b)
      console.log(`  couverture : ${pct(cov.exacts + cov.toleres, cov.tours)} des ${cov.tours} tours de Crâ (${cov.exacts} exacts, ${cov.toleres} avec un ` +
        `monstre lointain ailleurs) ; manches jouées d'affilée sans serveur, médiane ${m[Math.floor(m.length / 2)]}`)
      if (flag('--detail')) for (const x of cov.parCombat) console.log(`    ${x.id} — ${x.issue} : ${x.couverts}/${x.tours} tours, ${x.manches} manche(s) d'affilée`)
    }
  }
  console.log('\nCouverture : chaque combat appris rejoué contre le scénario appris des AUTRES combats (un tour couvert = joué sans serveur).')
}

function placements(): void {
  const reg = loadRegistry()
  console.log(`Placement par défaut (monstres inconnus) : ${reg.defaut ?? '(aucun)'}`)
  for (const p of reg.placements) {
    const lib = loadLibrary(p.nom)
    console.log(`\n${p.nom}${p.auto ? ' (auto)' : ''} : monstres ${p.monstres.map(m => `${m.nom ?? m.espece}@${m.cellule}`).join(', ')}`)
    console.log(`  placement ${JSON.stringify(casesOf(reg, p))}${p.cases ? '' : ' (par défaut)'}`)
    console.log(`  colonne ${JSON.stringify(colonneOf(reg, p))}${p.colonne ? '' : ' (par défaut)'}`)
    console.log(`  ${lib.combats.length} combat(s) appris, ${lib.branches.length} tour(s) distinct(s)`)
  }
}

function oublier(): void {
  const id = args[1]
  if (!id) throw new Error('oublier <identifiant de combat> attendu (voir resume --detail)')
  const reg = loadRegistry()
  let n = 0
  for (const p of reg.placements) {
    const lib = loadLibrary(p.nom)
    const gone = lib.combats.filter(x => x.id.startsWith(id))
    for (const c of gone) {
      removeFight(lib, c.id)
      console.log(`${p.nom} : ${c.id} oublié`)
    }
    if (gone.length) saveLibrary(lib)
    n += gone.length
  }
  if (!n) console.log(`Aucun combat appris ne commence par « ${id} ».`)
}

if (cmd === 'apprendre') {
  const paths = args.slice(1).filter(a => !a.startsWith('--'))
  if (!paths.length) throw new Error('apprendre <dossier ou session.jsonl>… attendu (ex. data/fightlogs)')
  const r = learn(paths, { dryRun: flag('--essai') })
  for (const l of r.lignes) console.log(l)
  console.log(`\n${r.appris} combat(s) appris, ${r.ignores} ignoré(s).`)
  if (r.nouveaux.length) console.log(`Placements nouveaux (data/reine/placements.json, à renommer) : ${r.nouveaux.join(', ')}`)
  for (const f of r.ecrits) console.log(`Écrit : ${relative(process.cwd(), f)}`)
  if (flag('--essai')) console.log('(--essai : rien n’a été écrit)')
  else console.log('Ensuite : npm run reine:combat (ReineCombat.lua avec les scénarios compilés).')
} else if (cmd === 'resume') resume()
else if (cmd === 'placements') placements()
else if (cmd === 'oublier') oublier()
else {
  console.log('npm run reine:scenarios -- apprendre <dossier ou session.jsonl>… [--essai]')
  console.log('npm run reine:scenarios -- resume [--depuis 2026-10-12] [--detail]')
  console.log('npm run reine:scenarios -- placements')
  console.log('npm run reine:scenarios -- oublier <identifiant de combat>')
  if (cmd && cmd !== 'aide' && cmd !== 'help') process.exitCode = 1
}
