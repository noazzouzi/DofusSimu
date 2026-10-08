/**
 * Section « Boss » du visualiseur — tableaux triables (web/src/boss-ui.ts) et ordre initial des tableaux de l'onglet
 * « Classes » (web/src/boss-classes.ts) : sens du premier clic par colonne (rang croissant, valeurs décroissantes,
 * textes croissants), inversion au clic suivant, flèche et `aria-sort` de l'ordre initial. Fonctions pures (HTML).
 */
import { describe, expect, it } from 'vitest'
import { defaultClassesSort } from '../web/src/boss-classes'
import { firstDir, nextSort, sortableTable, type Column } from '../web/src/boss-ui'

interface Row {
  rank: number
  name: string
  value: number
}
const rows: Row[] = [
  { rank: 1, name: 'Iop', value: 300 },
  { rank: 2, name: 'Crâ', value: 200 },
  { rank: 3, name: 'Sram', value: 100 },
]
const cols: Column<Row>[] = [
  { key: 'rank', label: '#', num: true, firstDir: 1, sort: r => r.rank, cell: r => String(r.rank) },
  { key: 'name', label: 'Classe', sort: r => r.name, cell: r => r.name },
  { key: 'value', label: 'DPT', num: true, sort: r => r.value, cell: r => String(r.value) },
]
/** Noms dans l'ordre des lignes rendues. */
const order = (html: string) => [...html.matchAll(/<tr><td class="num">\d+<\/td><td>([^<]+)<\/td>/g)].map(m => m[1])

describe('tableaux triables de la section Boss', () => {
  it('sens du premier clic : celui de la colonne, sinon décroissant si numérique et croissant pour un texte', () => {
    expect(cols.map(firstDir)).toEqual([1, 1, -1])
    expect(nextSort(undefined, 'rank', 1)).toEqual({ key: 'rank', dir: 1 })
    expect(nextSort({ key: 'value', dir: -1 }, 'rank', 1)).toEqual({ key: 'rank', dir: 1 })
    expect(nextSort({ key: 'rank', dir: 1 }, 'rank', 1)).toEqual({ key: 'rank', dir: -1 })
    expect(nextSort({ key: 'rank', dir: -1 }, 'rank', 1)).toEqual({ key: 'rank', dir: 1 })
  })

  it('les en-têtes portent le sens du premier clic (data-dir) et le tri courant (aria-sort, flèche)', () => {
    const html = sortableTable('t', cols, rows, { key: 'rank', dir: 1 })
    expect(html).toContain('data-key="rank" data-dir="1"')
    expect(html).toContain('data-key="name" data-dir="1"')
    expect(html).toContain('data-key="value" data-dir="-1"')
    expect(html).toMatch(/<th scope="col" class="num" aria-sort="ascending"><button[^>]*data-key="rank"[^>]*>#<span class="bv-arrow" aria-hidden="true">▲<\/span>/)
    expect(html.match(/aria-sort="none"/g)).toHaveLength(2)
    expect(order(html)).toEqual(['Iop', 'Crâ', 'Sram'])
    expect(order(sortableTable('t', cols, rows, { key: 'rank', dir: -1 }))).toEqual(['Sram', 'Crâ', 'Iop'])
    expect(order(sortableTable('t', cols, rows, { key: 'name', dir: 1 }))).toEqual(['Crâ', 'Iop', 'Sram'])
  })

  it('ordre initial des tableaux de l’onglet Classes : rangs croissants par axe, classes par nom', () => {
    expect(defaultClassesSort('axis-survival')).toEqual({ key: 'rank', dir: 1 })
    expect(defaultClassesSort('axis-damage')).toEqual({ key: 'rank', dir: 1 })
    expect(defaultClassesSort('classes')).toEqual({ key: 'class', dir: 1 })
    expect(defaultClassesSort('stuff-cmp')).toBeUndefined()
    expect(defaultClassesSort('bosses')).toBeUndefined()
  })
})
