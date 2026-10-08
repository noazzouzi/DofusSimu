/**
 * Section « Boss » — rendu de l'onglet « Classes » (`ClassRanking`, src/theorycraft/classes.ts) : un tableau triable par
 * axe (Dégâts, Survie, Contrôle, Soin, Apport d'équipe ; une ligne par classe, son meilleur preset, rang partagé « =1 »
 * des ex æquo), vue « Par classe » (meilleure valeur de chaque axe), composition suggérée avec ses raisons, atouts,
 * limites et confiance dépliables, règles, hypothèses et avertissements. Aucune note globale : chaque axe est montré.
 */
import type { ClassRanking } from './boss-api'
import type { PresetEvaluation, RankingAxis } from '@/theorycraft/types'
import { attr, elementChip, esc, fmtNum, fmtPct, foldList, sortableTable, type Column, type SortState } from './boss-ui'

/** État d'affichage de l'onglet (gardé par la vue entre deux rendus). */
export interface ClassesUi {
  /** Axe affiché, ou `classes` (meilleure valeur de chaque axe par classe). */
  axis: RankingAxis | 'classes'
  sorts: Map<string, SortState>
  /** Lignes dépliées (`axe:preset`) et membres de la composition dépliés (`comp:preset`). */
  open: Set<string>
}

const AXES: readonly RankingAxis[] = ['damage', 'survival', 'control', 'heal', 'team']

/**
 * Ordre initial d'un tableau de l'onglet (avant tout clic sur un en-tête) : rangs croissants pour un axe (ordre du
 * classement), classes par nom pour la vue « Par classe ». Signalé par la flèche et `aria-sort` de sa colonne.
 */
export function defaultClassesSort(table: string): SortState | undefined {
  if (table === 'classes') return { key: 'class', dir: 1 }
  if (table.startsWith('axis-')) return { key: 'rank', dir: 1 }
  return undefined
}

/** Valeur d'un axe à l'affichage (unités de `AxisRanking.unit`). */
export function axisValue(axis: RankingAxis, v: number): string {
  return axis === 'control' ? fmtNum(v, 2) : axis === 'team' ? `${fmtNum(v, 1)} %` : fmtNum(v)
}

/** Lecture de chaque axe (sous le titre du tableau). */
function axisNote(axis: RankingAxis, r: ClassRanking): string {
  switch (axis) {
    case 'damage':
      return 'Valeur : DPT soutenu analytique (classement). « Étalonné » = × étalonnage moteur du preset (contrôle, data/ai/calibration.json).'
    case 'survival':
      return r.stuff === 'optimized'
        ? 'PV effectifs du stuff seul (stuff optimisé de chaque preset) ; le kit défensif de la classe compte dans l’axe Soin.'
        : 'PV effectifs du stuff seul : même valeur pour les presets d’un même stuff générique (rang partagé « = »).'
    case 'control':
      return 'Valeur : PM + PA retirés en UN tour (un budget de PA). « PM seul » / « PA seul » : tour entier consacré à une réserve (non additionnables).'
    case 'heal':
      return `Valeur : PV utiles = min(brut, ${fmtNum(r.presets[0]?.heal.cap ?? 0)}) — dégâts d’un tour du boss sur un personnage ; soin et bouclier du tour mixte, boucliers supposés consommés.`
    case 'team':
      return 'Apport offensif à un allié de référence, en % de ses dégâts (« dommages subis » sur le boss, Puissance, Dommages, PA/PM).'
  }
}

interface Row {
  rank: number
  tied: boolean
  value: number
  e: PresetEvaluation
}

const confidenceChip = (level: string) => `<span class="bv-conf ${attr(level)}">${esc(level)}</span>`
const CONF_ORDER: Readonly<Record<string, number>> = { haute: 3, moyenne: 2, basse: 1 }

/** Colonnes de détail propres à chaque axe (comme le rendu texte de la CLI). */
function detailColumns(axis: RankingAxis): Column<Row>[] {
  switch (axis) {
    case 'damage':
      return [
        { key: 'cal', label: 'Étalonné', num: true, title: 'DPT × étalonnage moteur du preset (contrôle)', sort: r => r.e.dpt.calibrated, cell: r => `${fmtNum(r.e.dpt.calibrated)} <small class="bv-muted">×${fmtNum(r.e.dpt.calibration, 2)}</small>` },
        { key: 'burst', label: 'Rafale', num: true, title: 'Meilleur tour isolé (relances ignorées)', sort: r => r.e.dpt.burst, cell: r => fmtNum(r.e.dpt.burst) },
        { key: 'el', label: 'Élément (rés.)', sort: r => r.e.elementMatch.resPct, cell: r => elementChip(r.e.elementMatch.element, fmtPct(r.e.elementMatch.resPct)) },
        { key: 'stance', label: 'Posture', sort: r => r.e.stance.name, cell: r => (r.e.stance.id === 'base' ? '<span class="bv-muted">—</span>' : esc(r.e.stance.name)) },
      ]
    case 'survival':
      return [
        { key: 'hp', label: 'PV', num: true, sort: r => r.e.survival.hp, cell: r => fmtNum(r.e.survival.hp) },
        { key: 'inc', label: 'Reçus/tour', num: true, sort: r => r.e.survival.incoming, cell: r => fmtNum(r.e.survival.incoming) },
        { key: 'ttd', label: 'Tours', num: true, title: 'PV / dégâts reçus par tour', sort: r => r.e.survival.turnsToDie, cell: r => (r.e.survival.turnsToDie > 0 ? fmtNum(r.e.survival.turnsToDie, 1) : '—') },
      ]
    case 'control':
      return [
        { key: 'mp', label: 'PM', num: true, title: 'PM retirés (tour mixte)', sort: r => r.e.control.combined.mp, cell: r => fmtNum(r.e.control.combined.mp, 2) },
        { key: 'ap', label: 'PA', num: true, title: 'PA retirés (tour mixte)', sort: r => r.e.control.combined.ap, cell: r => fmtNum(r.e.control.combined.ap, 2) },
        { key: 'mp1', label: 'PM seul', num: true, sort: r => r.e.control.mpRemoved, cell: r => fmtNum(r.e.control.mpRemoved, 2) },
        { key: 'ap1', label: 'PA seul', num: true, sort: r => r.e.control.apRemoved, cell: r => fmtNum(r.e.control.apRemoved, 2) },
      ]
    case 'heal':
      return [
        { key: 'raw', label: 'Brut', num: true, title: 'Débit avant plafond', sort: r => r.e.heal.raw, cell: r => fmtNum(r.e.heal.raw) },
        { key: 'heal', label: 'Soin', num: true, sort: r => r.e.heal.mixed.heal, cell: r => fmtNum(r.e.heal.mixed.heal) },
        { key: 'shield', label: 'Bouclier', num: true, sort: r => r.e.heal.mixed.shield, cell: r => fmtNum(r.e.heal.mixed.shield) },
        { key: 'red', label: 'Réduction', num: true, sort: r => r.e.heal.reduction, cell: r => fmtPct(r.e.heal.reduction) },
        { key: 'armor', label: 'Armure', num: true, sort: r => r.e.heal.armor, cell: r => fmtNum(r.e.heal.armor) },
      ]
    case 'team':
      return [{ key: 'parts', label: 'Décomposition', cell: r => esc(r.e.team.parts.map(p => `${p.label} ${fmtNum(p.pct, 1)} %`).join(', ') || '—') }]
  }
}

/** Détail déplié d'un preset : atouts, limites, confiance, avertissements. */
function presetDetail(e: PresetEvaluation): string {
  const list = (items: readonly string[], empty: string) => (items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="bv-muted">${esc(empty)}</p>`)
  return `<div class="bv-detail">
    <div><h4>Atouts</h4>${list(e.relevance.atouts, 'Aucun atout particulier contre ce boss.')}</div>
    <div><h4>Limites</h4>${list(e.relevance.limites, 'Aucune limite particulière détectée.')}</div>
    <div><h4>Confiance ${confidenceChip(e.confidence.level)}</h4>${list(e.confidence.reasons, 'Mécaniques de la classe modélisées.')}</div>
    ${e.warnings.length ? `<div><h4>Avertissements</h4>${list(e.warnings, '')}</div>` : ''}
    <p class="bv-note">Stuff : ${esc(e.stuff)} · posture : ${esc(e.stance.name)} · DPT soutenu ${fmtNum(e.dpt.steady)}, rafale ${fmtNum(e.dpt.burst)} · PV ${fmtNum(e.survival.hp)}, PV effectifs ${fmtNum(e.survival.ehp)}${
      e.optimization ? ` · objectif J ${fmtNum(e.optimization.startJ, 3)} → ${fmtNum(e.optimization.bestJ, 3)}` : ''
    }</p>
  </div>`
}

/** Tableau d'un axe. */
function axisTable(r: ClassRanking, axis: RankingAxis, ui: ClassesUi): string {
  const a = r.axes.find(x => x.axis === axis)
  if (!a) return ''
  const byId = new Map(r.presets.map(e => [e.presetId, e]))
  const rows: Row[] = a.entries.map(x => ({ rank: x.rank, tied: x.tied, value: x.value, e: byId.get(x.presetId)! })).filter(x => x.e)
  const id = `axis-${axis}`
  const key = (row: Row) => `${axis}:${row.e.presetId}`
  const cols: Column<Row>[] = [
    { key: 'rank', label: '#', num: true, firstDir: 1, title: 'Rang sur cet axe (« = » : ex æquo)', sort: row => row.rank, cell: row => `<span class="bv-rank${row.rank <= 3 ? ` top${row.rank}` : ''}">${row.tied ? '=' : ''}${row.rank}</span>` },
    {
      key: 'class',
      label: 'Classe (preset)',
      title: 'Meilleur preset de la classe sur cet axe ; cliquer pour ses atouts, limites et la confiance',
      sort: row => row.e.className,
      cell: row => {
        const open = ui.open.has(key(row))
        return `<button type="button" class="bv-row-toggle" data-act="row" data-key="${attr(key(row))}" aria-expanded="${open}"><span class="bv-chev" aria-hidden="true"></span><span class="bv-who"><b>${esc(
          row.e.className,
        )}</b><small title="${attr(row.e.label)}">${esc(row.e.presetId)}</small></span></button>`
      },
    },
    { key: 'value', label: a.unit, num: true, sort: row => row.value, cell: row => `<b>${axisValue(axis, row.value)}</b>` },
    ...detailColumns(axis),
    { key: 'conf', label: 'Confiance', sort: row => CONF_ORDER[row.e.confidence.level] ?? 0, cell: row => confidenceChip(row.e.confidence.level) },
    { key: 'go', label: '', cell: row => `<button type="button" class="link-btn" data-act="to-stuff" data-preset="${attr(row.e.presetId)}" title="Chercher le meilleur stuff de ce preset contre ce boss">Stuff</button>` },
  ]
  const span = cols.length
  return `<p class="bv-note">${esc(axisNote(axis, r))}</p>
    ${sortableTable(id, cols, rows, ui.sorts.get(id) ?? defaultClassesSort(id), {
      cls: 'bv-ranking',
      rowAttrs: row => (ui.open.has(key(row)) ? 'class="open"' : ''),
      after: row => (ui.open.has(key(row)) ? `<tr class="bv-detail-row"><td colspan="${span}">${presetDetail(row.e)}</td></tr>` : ''),
    })}`
}

/** Vue « Par classe » : meilleure valeur de chaque axe. */
function classesTable(r: ClassRanking, ui: ClassesUi): string {
  const id = 'classes'
  const label = (axis: RankingAxis) => r.axes.find(a => a.axis === axis)?.label ?? axis
  const cols: Column<ClassRanking['classes'][number]>[] = [
    { key: 'class', label: 'Classe', sort: c => c.className, cell: c => `<b>${esc(c.className)}</b>` },
    ...AXES.map(
      (axis): Column<ClassRanking['classes'][number]> => ({
        key: axis,
        label: label(axis),
        num: true,
        sort: c => c.best[axis].value,
        cell: c => `${axisValue(axis, c.best[axis].value)}<small class="bv-sub">${esc(c.best[axis].presetId)}</small>`,
      }),
    ),
    { key: 'conf', label: 'Confiance', title: 'Confiance du modèle pour la classe (mécaniques non modélisées)', sort: c => CONF_ORDER[c.confidence] ?? 0, cell: c => confidenceChip(c.confidence) },
  ]
  return `<p class="bv-note">Meilleur preset de chaque classe sur chaque axe (axes indépendants : un tour consacré au retrait ou au soin n’est pas consacré aux dégâts).</p>
    ${sortableTable(id, cols, r.classes, ui.sorts.get(id) ?? defaultClassesSort(id), { cls: 'bv-overview' })}`
}

/** Composition suggérée : membres, raisons, atouts / limites / confiance dépliables, règles et notes. */
function composition(r: ClassRanking, ui: ClassesUi): string {
  const byId = new Map(r.presets.map(e => [e.presetId, e]))
  const cards = r.composition.members
    .map(m => {
      const e = byId.get(m.presetId)
      const k = `comp:${m.presetId}:${m.slot}`
      return `<li class="bv-member">
        <div class="bv-member-head"><span class="bv-slot">${esc(m.slot)}</span>${e ? confidenceChip(e.confidence.level) : ''}</div>
        <b class="bv-member-name">${esc(m.className)}</b>
        <span class="bv-preset">${esc(e?.label ?? m.presetId)}<code>${esc(m.presetId)}</code></span>
        <p>${esc(m.reason)}</p>
        ${e ? `<details data-key="${attr(k)}"${ui.open.has(k) ? ' open' : ''}><summary>Atouts, limites et confiance</summary>${presetDetail(e)}</details>` : ''}
      </li>`
    })
    .join('')
  return `<section class="panel bv-card" aria-labelledby="bv-comp-title">
    <header class="panel-head"><h2 id="bv-comp-title">Composition suggérée</h2><span class="hint">${r.players} personnage${r.players > 1 ? 's' : ''}, règles explicites</span></header>
    <ul class="bv-members">${cards}</ul>
    <div class="bv-pad bv-stack">
      ${foldList('Notes de la composition', r.composition.notes, 'inner', true)}
      ${foldList('Règles', r.composition.rules, 'inner')}
    </div>
  </section>`
}

/** Onglet « Classes » complet (classement déjà calculé). */
export function renderClasses(r: ClassRanking, ui: ClassesUi): string {
  const tabs = [...AXES.map(axis => ({ id: axis as ClassesUi['axis'], label: r.axes.find(a => a.axis === axis)?.label ?? axis })), { id: 'classes' as const, label: 'Par classe' }]
  return `<section class="panel bv-card" aria-labelledby="bv-axes-title">
      <header class="panel-head"><h2 id="bv-axes-title">Classement par axe</h2><span class="hint">aucune note globale · les classements valent plus que les valeurs absolues</span></header>
      <div class="bv-pills" role="tablist" aria-label="Axe affiché">${tabs
        .map(t => `<button type="button" role="tab" class="bv-pill" data-act="axis" data-axis="${t.id}" aria-selected="${ui.axis === t.id}">${esc(t.label)}</button>`)
        .join('')}</div>
      <div class="bv-axis" role="tabpanel">${ui.axis === 'classes' ? classesTable(r, ui) : axisTable(r, ui.axis, ui)}</div>
    </section>
    ${composition(r, ui)}
    ${foldList('Avertissements', r.warnings, 'warn')}
    ${foldList('Hypothèses', r.assumptions)}`
}
