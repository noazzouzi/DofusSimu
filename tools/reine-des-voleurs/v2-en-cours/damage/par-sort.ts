// Dégâts moyens (critique pondéré) de CHAQUE sort offensif du Crâ (les 2 variantes des 22 paires, grade niveau 200)
// contre chaque monstre, avec les caractéristiques réelles du Crâ.
//  - « calc » : calculateur analytique, 1er lancer, lignes immédiates sans condition (comme `degats`).
//  - « moteur 1er » : un lancer dans le moteur sur une cible neuve (sous-sorts, états, effets différés comptés).
//  - « moteur régime » : sort lancé seul au rythme maximal (lancers/tour et /cible, relance) pendant 14 tours, PA
//    illimités, mesure sur les tours 7 à 14 : dégâts par lancer et par tour en régime établi (rampes 293, poisons).
// Cible à distance, en ligne, à d = 4 cases (ou la PO min du sort / 3 pour Carreaux), coup « à distance ».
// Reine : multiplicateur des bombes ×0,9ⁿ appliqué ensuite (n = 0..4).
import { writeFileSync } from 'node:fs'
import { ALL_SPELLS, PAIRS, TARGETS, bench, calcSpell, fmt, inLine, isOffensive, lvlOf, nameOf, pad, lpad, spellRange, EL_FR, CRA } from './lib'

const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
const json: Record<string, unknown>[] = []
log('Crâ : 12 PA 5 PM 4 PO | Fo 579 Int 728 Cha 290 Agi 519 Pui 169 | Do N/T/F/E/A 56/67/84/38/45 | CC 79 % DoCri 95 | %sorts 10 %dist 6')
log('Valeurs : dégâts moyens par LANCER (critique pondéré), coup à distance. calc = 1er lancer analytique ; 1er = moteur, cible neuve ; rég = moteur, régime établi au rythme max.')
log('')
for (const [k, [a, b]] of PAIRS.entries()) {
  for (const id of [a, b]) {
    const lv = lvlOf(id)
    const [mn, mx] = spellRange(id)
    const head = `P${k + 1} ${id === a ? 'base' : 'var.'} ${nameOf(id)} (${id}) ${lv.apCost} PA, PO ${mn}-${mx}${lv.castInLine ? ' en ligne' : ''}${lv.castTestLos ? '' : ' sans LdV'}, ${lv.maxCastPerTurn || '∞'}/tour ${lv.maxCastPerTarget || '∞'}/cible, relance ${lv.minCastInterval}, CC ${lv.critChance}+79 → ${Math.min(100, lv.critChance + CRA.critical)} %`
    if (!isOffensive(id)) { log(`${head} — pas de dégâts directs`); continue }
    log(head)
    const d = id === 32459 ? 3 : Math.max(mn, Math.min(4, mx))
    const nCast = Math.max(1, Math.min(lv.maxCastPerTurn || 6, lv.maxCastPerTarget || 6, lv.maxGlobalCastPerTurn || 6))
    const rows: string[] = []
    for (const t of TARGETS) {
      const c = calcSpell(id, t)
      const first = bench([[{ spell: id }]], t, inLine(d), { turns: 1, warm: 0, apOverride: 99 })
      const steady = bench([Array.from({ length: nCast }, () => ({ spell: id }))], t, inLine(d), { turns: 14, warm: 6, apOverride: 99 })
      const cpt = steady.casts.get(id) ?? 0
      const perCast = cpt > 0 ? steady.mean / cpt : 0
      const els = [...new Set(c.lines.map(l => EL_FR[l.element]))].join('+')
      rows.push(`    ${pad(t.name, 13)} calc ${lpad(fmt(c.immediate), 6)} | 1er ${lpad(fmt(first.mean), 6)} | rég ${lpad(fmt(perCast), 6)}/lancer × ${cpt.toFixed(2)} lancers/tour = ${lpad(fmt(steady.mean), 6)}/tour${steady.refused.size ? ` (refus ${[...steady.refused].map(([r, n]) => `${r}×${n.toFixed(1)}`).join(', ')})` : ''}${t.id === 3726 ? ` | ×0,9ⁿ n=1..4 : ${[1, 2, 3, 4].map(n => fmt(perCast * 0.9 ** n)).join(' / ')}` : ''}`)
      json.push({ spellId: id, name: nameOf(id), pair: k + 1, variant: id === a ? 0 : 1, ap: lv.apCost, target: t.name, targetId: t.id, calc: c.immediate, first: first.mean, steadyPerCast: perCast, castsPerTurn: cpt, steadyPerTurn: steady.mean, elements: els, critPct: c.critPct, lines: c.lines, distance: d })
    }
    log(`    élément(s) : ${[...new Set(calcSpell(id, TARGETS[1]).lines.map(l => EL_FR[l.element]))].join(' + ') || '—'} ; mesure à d = ${d} en ligne`)
    for (const r of rows) log(r)
  }
}
writeFileSync(new URL('./par-sort.json', import.meta.url), JSON.stringify(json, null, 1))
writeFileSync(new URL('./par-sort.txt', import.meta.url), out.join('\n') + '\n')
void ALL_SPELLS
