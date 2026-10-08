/**
 * Section « Boss » — briques de rendu partagées par la fiche, les classes et le stuff (web/src/boss-*.ts) : nombres à la
 * française, éléments et leurs couleurs (`--el-*`), étiquettes des mécaniques et des utilités, tableaux triables,
 * barres empilées, listes repliables. Fonctions pures qui rendent du HTML (textes échappés).
 */
import { ELEMENT_LABELS, fmtNum, fmtPct, MECHANIC_LABELS } from '@/theorycraft/formatBoss'
import type { MechanicKind, PerElement, UtilityTag } from '@/theorycraft/types'
import { esc } from './ui/panels'

export { esc, fmtNum, fmtPct, ELEMENT_LABELS }

export const attr = (s: string) => esc(s).replace(/"/g, '&quot;')

/** Classe CSS de couleur d'un élément (index [Neutre, Terre, Feu, Eau, Air]). */
const EL_CLASS = ['el-neutral', 'el-earth', 'el-fire', 'el-water', 'el-air'] as const
export const elClass = (i: number) => EL_CLASS[i] ?? 'el-neutral'
/** Élément d'un preset ou d'un stuff (`earth`…) → index. */
export const ELEMENT_INDEX: Readonly<Record<string, number>> = { neutral: 0, earth: 1, fire: 2, water: 3, air: 4 }

export const mechanicLabel = (k: MechanicKind) => MECHANIC_LABELS[k] ?? k

/** Libellés courts des utilités (contre / punit), comme la fiche texte de la CLI. */
const TAG_LABELS: Readonly<Record<UtilityTag, string>> = {
  melee: 'mêlée',
  range: 'distance',
  zone: 'zone',
  burst: 'rafale',
  'indirect-damage': 'dégâts indirects',
  'mp-removal': 'retrait PM',
  'ap-removal': 'retrait PA',
  'range-removal': 'retrait PO',
  heal: 'soin',
  shield: 'boucliers',
  'damage-reduction': 'réductions',
  placement: 'placement',
  'push-damage': 'poussée',
  summons: 'invocations',
  debuff: 'débuff',
  erosion: 'érosion',
  'ally-ap-mp': '+PA/PM alliés',
  'ally-damage': 'buffs alliés',
  'damage-taken-debuff': 'dommages subis',
  dodge: 'esquive',
  'multi-element': 'multi-élément',
}
export const tagLabel = (t: UtilityTag) => TAG_LABELS[t] ?? t

/** Pastille d'élément (couleur + nom). */
export function elementChip(i: number, extra = ''): string {
  return `<span class="bv-el ${elClass(i)}"><i aria-hidden="true"></i>${esc(ELEMENT_LABELS[i] ?? '?')}${extra ? ` <b>${esc(extra)}</b>` : ''}</span>`
}

/**
 * Barre empilée des parts par élément (somme ≤ 1), avec un libellé accessible ; `legend` : légende textuelle sous la
 * barre (éléments présents seulement).
 */
export function shareBar(shares: PerElement | readonly number[], legend = false): string {
  const parts = shares.map((v, i) => ({ v, i })).filter(x => x.v > 0.0005)
  if (!parts.length) return '<span class="bv-muted">aucun dégât calculable</span>'
  const label = parts.map(x => `${ELEMENT_LABELS[x.i]} ${fmtPct(x.v * 100)}`).join(', ')
  const bar = `<span class="bv-bars" role="img" aria-label="${attr(label)}" title="${attr(label)}">${parts
    .map(x => `<i class="${elClass(x.i)}" style="width:${(x.v * 100).toFixed(2)}%"></i>`)
    .join('')}</span>`
  if (!legend) return bar
  return `${bar}<span class="bv-legend">${parts.map(x => `<span class="${elClass(x.i)}"><i aria-hidden="true"></i>${esc(ELEMENT_LABELS[x.i])} ${fmtPct(x.v * 100)}</span>`).join('')}</span>`
}

/** Liste repliable (avertissements, hypothèses) : fermée par défaut, nombre d'éléments dans le titre. */
export function foldList(title: string, items: readonly string[], cls = '', open = false): string {
  if (!items.length) return ''
  return `<details class="panel bv-fold ${cls}"${open ? ' open' : ''}><summary><span>${esc(title)}</span><span class="bv-count">${items.length}</span></summary>
    <ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`
}

// ───────────────────────────── tableaux triables ─────────────────────────────

/** Tri d'un tableau : colonne et sens. */
export interface SortState {
  key: string
  dir: 1 | -1
}

/** Colonne d'un tableau triable. */
export interface Column<T> {
  key: string
  label: string
  /** Infobulle de l'en-tête (lecture de la colonne). */
  title?: string
  /** Colonne numérique (alignée à droite, tri décroissant au premier clic). */
  num?: boolean
  /** Valeur de tri (absente : colonne non triable). */
  sort?: (row: T) => number | string
  cell: (row: T) => string
}

/**
 * Tableau triable : en-têtes boutons (`data-act="sort"`, `data-table`, `data-key`), `aria-sort` sur la colonne triée.
 * `rowAttrs` : attributs de la ligne ; `after` : ligne(s) insérée(s) après une ligne (détail déplié).
 */
export function sortableTable<T>(
  id: string,
  cols: readonly Column<T>[],
  rows: readonly T[],
  sort: SortState | undefined,
  opts: { caption?: string; rowAttrs?: (row: T) => string; after?: (row: T) => string; cls?: string } = {},
): string {
  const col = sort && cols.find(c => c.key === sort.key && c.sort)
  const sorted = col
    ? rows
        .map((r, i) => ({ r, i }))
        .sort((a, b) => {
          const x = col.sort!(a.r)
          const y = col.sort!(b.r)
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')
          return c * sort!.dir || a.i - b.i
        })
        .map(x => x.r)
    : rows
  const head = cols
    .map(c => {
      const cls = c.num ? ' class="num"' : ''
      if (!c.sort) return `<th scope="col"${cls}${c.title ? ` title="${attr(c.title)}"` : ''}>${esc(c.label)}</th>`
      const active = sort?.key === c.key
      const ariaSort = active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'
      const arrow = active ? (sort!.dir === 1 ? '▲' : '▼') : ''
      return `<th scope="col"${cls} aria-sort="${ariaSort}"><button type="button" class="bv-sort${active ? ' on' : ''}" data-act="sort" data-table="${attr(id)}" data-key="${attr(c.key)}"${
        c.title ? ` title="${attr(c.title)}"` : ''
      }>${esc(c.label)}<span class="bv-arrow" aria-hidden="true">${arrow}</span></button></th>`
    })
    .join('')
  const body = sorted
    .map(r => `<tr${opts.rowAttrs ? ` ${opts.rowAttrs(r)}` : ''}>${cols.map(c => `<td${c.num ? ' class="num"' : ''}>${c.cell(r)}</td>`).join('')}</tr>${opts.after?.(r) ?? ''}`)
    .join('')
  return `<div class="bv-scroll"><table class="bv-table ${opts.cls ?? ''}" data-table-id="${attr(id)}">${opts.caption ? `<caption>${esc(opts.caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** Clic sur un en-tête : même colonne ⇒ sens inversé ; nouvelle colonne ⇒ décroissant si numérique, sinon croissant. */
export function nextSort(current: SortState | undefined, key: string, numeric: boolean): SortState {
  if (current?.key === key) return { key, dir: current.dir === 1 ? -1 : 1 }
  return { key, dir: numeric ? -1 : 1 }
}

/** Indicateur de chargement (texte lu par les lecteurs d'écran). */
export function spinner(text: string): string {
  return `<div class="bv-loading" role="status"><span class="bv-spin" aria-hidden="true"></span><span>${esc(text)}</span></div>`
}

/** Encadré d'erreur. */
export function errorBox(text: string): string {
  return `<p class="bv-error" role="alert">${esc(text)}</p>`
}
