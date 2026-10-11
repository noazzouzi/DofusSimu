// Planificateur de tour — Reine des Voleurs, 4 Crâs.
//
//   npx tsx tools/reine-des-voleurs/planificateur/index.ts --manche 2 --joueur Java
//   npx tsx tools/reine-des-voleurs/planificateur/index.ts --etat mon-etat.json
// Options : --journal <fichiers .jsonl séparés par des virgules> (défaut : journal du 2026-10-09), --top 5,
//           --faisceau 8, --lancers 5, --json <fichier> (écrit l'instantané utilisé).
import { writeFileSync, readFileSync } from 'node:fs'
import { data, type Snapshot } from './etat'
import { readStream, snapshotAt, type TurnRecord } from './journal'
import { planTurn, type PlannedTurn } from './recherche'

const DEFAULT_FILES = ['session-10-16-34.jsonl', 'session-10-35-50.jsonl'].map(f => `data/fightlogs/2026-10-09/${f}`)
const CRAS: Record<string, number> = { Kemist: 900266590501, Java: 900265148709, Lowkey: 900264689957, Lamouit: 900264624421 }
const NAMES: Record<number, string> = Object.fromEntries(Object.entries(CRAS).map(([k, v]) => [v, k]))

const args = process.argv.slice(2)
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}

let snap: Snapshot
let actual: TurnRecord | undefined
if (opt('etat')) snap = JSON.parse(readFileSync(opt('etat')!, 'utf8'))
else {
  const who = opt('joueur', 'Java')!
  const id = CRAS[who] ?? Number(who)
  const files = (opt('journal') ?? DEFAULT_FILES.join(',')).split(',')
  const rows = readStream(files, Object.values(CRAS)[0])
  const r = snapshotAt(rows, Number(opt('manche', '1')), id, NAMES)
  snap = r.snap
  actual = r.actual
}
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(snap, null, 1))

const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`
const entName = (gid: number) => snap.entities.find(e => e.gameId === gid)?.name ?? NAMES[gid] ?? String(gid)

console.log(`=== ${snap.source ?? 'instantané'}`)
for (const e of snap.entities) {
  const extra = e.kind === 'bomb' ? `bombe de ${entName(e.owner!)}, manche ${e.born}${e.blue ? ', BLEUE' : ''}` : e.hp !== undefined ? `${e.hp}/${e.maxHp} PV` : ''
  console.log(`  ${e.name.padEnd(24)} case ${String(e.cell).padEnd(4)} ${extra}`)
}

const t0 = Date.now()
const res = planTurn(snap, { top: Number(opt('top', '5')), beam: Number(opt('faisceau', '8')), maxCasts: Number(opt('lancers', '5')) })

function describe(p: PlannedTurn, rank: string) {
  const lines: string[] = []
  const dmg = [...p.damage].map(([gid, v]) => `${entName(gid)} −${Math.round(v)}`).join(', ')
  lines.push(`${rank} ${Math.round(p.total)} dégâts${dmg ? ` (${dmg})` : ''}${p.killed.length ? `, tue ${p.killed.map(entName).join(', ')}` : ''} — PA ${p.apUsed}, PM ${p.mpUsed}, fin en ${p.endCell}`)
  for (const s of p.steps) {
    if (s.kind === 'move') lines.push(`     déplacement ${s.path.join('→')}`)
    else {
      const occ = res.built.fight.fighters.find(f => f.alive && f.cell === s.cell)
      const tgt = occ ? `${entName(res.built.gameIdOf.get(occ.id)!)} (${s.cell})` : `case ${s.cell}`
      lines.push(`     ${spellName(s.spell)} → ${s.cell === p.shootCell && !occ ? 'soi' : tgt}`)
    }
  }
  if (p.threats.length) {
    for (const t of p.threats.slice(0, 3)) {
      const m = res.built.fight.fighters[t.monster]
      lines.push(`     ⚠ ${m.name} peut toucher ${p.endCell} avec ${spellName(t.spell)} depuis ${t.from}${t.viaSwap !== undefined ? ` (après échange en ${t.viaSwap})` : ''}`)
    }
  }
  for (const d of p.laterDeaths) lines.push(`     ⚠ ${entName(d.id)} serait tué plus tard par une bombe s'il ne bouge pas (manche ${d.round}, tour de ${entName(d.turnOf)})`)
  for (const d of p.bombDeaths) lines.push(`     ⚠ ${entName(d.id)} tué par une bombe (manche ${d.round}, ${d.atActiveEnd ? 'à la fin de ce tour' : `tour de ${entName(d.turnOf)}`})`)
  return lines.join('\n')
}

console.log(`\n${res.plans.length ? 'Meilleurs tours SÛRS' : 'Aucun tour sûr trouvé'} (${res.evaluated} lancers évalués, ${((Date.now() - t0) / 1000).toFixed(1)} s) :`)
res.plans.forEach((p, i) => console.log(describe(p, `${i + 1}.`)))
if (res.unsafe.length) {
  console.log(`\nMeilleurs tours NON sûrs (pour comparaison) :`)
  res.unsafe.slice(0, 2).forEach((p, i) => console.log(describe(p, `${i + 1}.`)))
}
if (actual) {
  const real = actual.damage.reduce((s, d) => s + d.amount, 0)
  const casts = actual.casts.filter(c => ![4693, 4692, 4691, 5952, 32558, 32998].includes(c.spell)).map(c => spellName(c.spell)).join(', ')
  const end = actual.moves.at(-1)?.at(-1) ?? snap.entities.find(e => e.gameId === snap.active)?.cell
  console.log(`\nCe qui a été joué : ${casts || 'aucun sort'} ; fin en ${end} ; ${real} dégâts réels.`)
}
