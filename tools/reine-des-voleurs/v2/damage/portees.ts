// Portées effectives des sorts du Crâ (PO 4) : seules, sous Tirs Puissants (−3 PO), sous Sentinelle (+10 PO, −1 par PM
// utilisé), sous Tirs Éloignés (+6 PO max et +3 PO min, sorts listés dans ses effets 280/281). Données.
import { writeFileSync } from 'node:fs'
import { PAIRS, lvlOf, nameOf, pad } from './lib'
const TE = new Set<number>()
for (const e of lvlOf(32465).effects) if (e.effectId === 281) TE.add(e.diceNum)
const out: string[] = []
out.push(`${pad('sort', 30)} PA  base     PO4     +TirsPuiss.  +Sentinelle(0 PM)  +TirsÉloignés  ligne LdV`)
PAIRS.forEach(([a, b], i) => {
  for (const id of [a, b]) {
    const lv = lvlOf(id)
    const boost = (r: number) => (lv.rangeBoostable ? Math.max(lv.minRange, lv.range + r) : lv.range)
    const te = TE.has(id) ? `${lv.minRange + 3}-${Math.max(lv.minRange + 3, boost(4) + 6)}` : '—'
    out.push(`${pad(`P${i + 1}${id === a ? 'b' : 'v'} ${nameOf(id)}`, 30)} ${lv.apCost}   ${pad(`${lv.minRange}-${lv.range}${lv.rangeBoostable ? '+' : ''}`, 8)} ${pad(`${lv.minRange}-${boost(4)}`, 7)} ${pad(`${lv.minRange}-${boost(1)}`, 12)} ${pad(`${lv.minRange}-${boost(14)}`, 18)} ${pad(te, 14)} ${lv.castInLine ? 'ligne' : '     '} ${lv.castTestLos ? 'LdV' : 'sans LdV'}`)
  }
})
writeFileSync(new URL('./portees.txt', import.meta.url), out.join('\n') + '\n')
console.log(out.join('\n'))
