import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
type C = { id: string; issue: any; modificateur?: string; mules?: string[]; debut?: string }
const fights: (C & { placement: string; vides: Record<string, number>; tours: Record<string, number> })[] = []
for (const f of readdirSync('data/reine/scenarios')) {
  const l = JSON.parse(readFileSync(join('data/reine/scenarios', f), 'utf8'))
  const vides: Record<string, Record<string, number>> = {}, tours: Record<string, Record<string, number>> = {}
  for (const b of l.branches) for (const o of b.joue) {
    (tours[o.combat] ??= {})[b.perso] = ((tours[o.combat] ??= {})[b.perso] ?? 0) + 1
    if (!b.actions.length) (vides[o.combat] ??= {})[b.perso] = ((vides[o.combat] ??= {})[b.perso] ?? 0) + 1
  }
  for (const c of l.combats) fights.push({ ...c, placement: l.placement, vides: vides[c.id] ?? {}, tours: tours[c.id] ?? {} })
}
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) + ' %' : '—')
for (const mode of ['4 Crâs', 'mule'] as const) {
  const F = fights.filter(c => (mode === 'mule') === !!c.mules?.length && c.issue.fin !== 'interrompu')
  const W = F.filter(c => c.issue.fin === 'victoire')
  console.log(`\n===== Mode ${mode} : ${F.length} combats, ${W.length} victoires (${pct(W.length, F.length)})`)
  const lowkeyVides = (c: any) => c.vides['Lowkey-Jealous'] ?? 0
  const avec = F.filter(c => lowkeyVides(c) >= 3), sans = F.filter(c => lowkeyVides(c) < 3)
  console.log(`  Lowkey ≥ 3 tours sans action : ${avec.length} combats, ${avec.filter(c => c.issue.fin === 'victoire').length} victoires (${pct(avec.filter(c => c.issue.fin === 'victoire').length, avec.length)})`)
  console.log(`  sinon                         : ${sans.length} combats, ${sans.filter(c => c.issue.fin === 'victoire').length} victoires (${pct(sans.filter(c => c.issue.fin === 'victoire').length, sans.length)})`)
  // par modificateur (combats sans tours perdus)
  const mods = [...new Set(sans.map(c => c.modificateur))].sort()
  console.log('  par modificateur (combats sans tours perdus) : ' + mods.map(m => { const x = sans.filter(c => c.modificateur === m); return `${m} ${x.filter(c => c.issue.fin === 'victoire').length}/${x.length}` }).join(' · '))
  // défaites sans tours perdus : quand et qui meurt en premier
  const D = sans.filter(c => c.issue.fin !== 'victoire')
  const vague: Record<number, number> = {}, premier: Record<string, number> = {}, manche: number[] = []
  for (const c of D) {
    vague[c.issue.vagues] = (vague[c.issue.vagues] ?? 0) + 1
    const m = [...c.issue.morts].sort((a: any, b: any) => a.manche - b.manche)
    if (m[0]) { premier[m[0].nom] = (premier[m[0].nom] ?? 0) + 1; manche.push(m[0].manche) }
  }
  manche.sort((a, b) => a - b)
  console.log(`  défaites sans tours perdus : ${D.length} ; vague atteinte ${JSON.stringify(vague)} ; 1re mort en manche (médiane) ${manche[manche.length >> 1] ?? '—'} ; premier Crâ mort ${JSON.stringify(premier)}`)
  const allMorts = D.map(c => c.issue.morts.length)
  console.log(`  Crâs morts par défaite : ${JSON.stringify(allMorts.reduce((a: any, n) => ((a[n] = (a[n] ?? 0) + 1), a), {}))}`)
  // durée des victoires
  const mw = W.map(c => c.issue.manches).sort((a, b) => a - b)
  console.log(`  victoires : manches médiane ${mw[mw.length >> 1]} (min ${mw[0]}, max ${mw[mw.length - 1]}) ; victoires avec un Crâ mort : ${W.filter(c => c.issue.morts.length).length}`)
}
