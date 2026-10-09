/**
 * Section « Boss » — onglet « Stuff » : formulaire (preset, lien RoxxSolver, éléments, profil, top, effort de recherche)
 * et rendu du résultat (`StuffVsBossResult`, src/theorycraft/stuff.ts) — tableau comparatif (départ, stuffs génériques,
 * stuffs optimisés), meilleur stuff objet par objet (icônes DofusDB, repli hors ligne sur l'initiale de l'emplacement),
 * objets changés, autres stuffs du top, comparaison des éléments, équivalences des caractéristiques, DPT par sort,
 * hypothèses et avertissements ; style de jeu du personnage (au contact ou à distance) et son explication quand il
 * diffère de celui du preset ou que la part mesurée le contredit. HTML seulement : rien n'est recalculé ici.
 */
import type { ExpProfile, StuffVsBossResult, TheoryPreset } from './boss-api'
import type { StuffEvaluation, StuffItemLine } from '@/theorycraft/types'
import { attr, ELEMENT_INDEX, elementChip, esc, fmtNum, fmtPct, foldList, sortableTable, type Column, type SortState } from './boss-ui'

/** Images des objets (DofusDB), comme la section « Stuffs ». */
const ICON_URL = (iconId: number) => `https://api.dofusdb.fr/img/items/${iconId}.png`

/** Valeurs du formulaire (gardées par la vue). */
export interface StuffForm {
  /** Preset (id) ; vide : déduit de la classe du lien RoxxSolver. */
  preset: string
  roxx: string
  elements: 'preset' | 'all'
  profile: ExpProfile
  top: number
  iterations: number
}

/** Efforts de recherche proposés (itérations du recuit par recherche ; 30 000 = défaut de la CLI). */
export const SEARCH_EFFORTS: readonly { iterations: number; label: string }[] = [
  { iterations: 3_000, label: 'Rapide (3 000)' },
  { iterations: 30_000, label: 'Normale (30 000)' },
  { iterations: 100_000, label: 'Poussée (100 000)' },
]
const PROFILES: readonly [ExpProfile, string][] = [
  ['balanced', 'Équilibré'],
  ['defensive', 'Défensif'],
  ['offensive', 'Offensif'],
]
const ELEMENT_FR: Readonly<Record<string, string>> = { earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air' }

const opt = (value: string | number, label: string, selected: boolean) => `<option value="${attr(String(value))}"${selected ? ' selected' : ''}>${esc(label)}</option>`

/** Réglages du formulaire qui changent le résultat, et leur nom dans la note « résultat périmé ». */
const FORM_FIELDS: readonly (readonly [keyof StuffForm, string])[] = [
  ['preset', 'preset'],
  ['roxx', 'lien RoxxSolver'],
  ['elements', 'éléments'],
  ['profile', 'profil'],
  ['top', 'stuffs rendus'],
  ['iterations', 'recherche'],
]

/**
 * Le résultat affiché répond-il encore au formulaire ? `done` : réglages de la demande qui l'a produit ; `who` : le
 * personnage de ce résultat (« « Crâ Terre mono-cible » (cra_terre_mono) »). Undefined s'il y répond ; sinon la note
 * « Résultat pour <preset> — … : relancez le calcul » (preset changé à la main, ou par le bouton « Stuff » de l'onglet
 * Classes ; autre réglage changé).
 */
export function staleStuffNote(done: StuffForm, form: StuffForm, who: string): string | undefined {
  const value = (f: StuffForm, k: keyof StuffForm) => (k === 'roxx' ? f.roxx.trim() : f[k])
  const changed = FORM_FIELDS.filter(([k]) => value(done, k) !== value(form, k)).map(([, label]) => label)
  return changed.length ? `Résultat pour ${who} — réglages changés depuis le calcul (${changed.join(', ')}) : relancez le calcul.` : undefined
}

/** Formulaire de l'onglet. */
export function renderStuffForm(f: StuffForm, presets: readonly TheoryPreset[], busy: boolean): string {
  const classes = [...new Map(presets.map(p => [p.breedId, p.className])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  const presetOptions =
    opt('', 'Automatique (classe du lien RoxxSolver)', f.preset === '') +
    classes
      .map(
        ([breedId, name]) =>
          `<optgroup label="${attr(name)}">${presets
            .filter(p => p.breedId === breedId)
            .map(p => opt(p.id, `${p.label} — ${p.roleLabel}, ${ELEMENT_FR[p.element] ?? p.element}`, p.id === f.preset))
            .join('')}</optgroup>`,
      )
      .join('')
  return `<form class="panel bv-card bv-form" id="bv-stuff-form" novalidate>
    <header class="panel-head"><h2>Meilleur stuff contre ce boss</h2><span class="hint">optimiseur de stuff, cible = ce boss</span></header>
    <div class="bv-fields">
      <label class="bv-field wide"><span>Personnage (preset)</span><span class="select-wrap"><select name="preset">${presetOptions}</select></span></label>
      <label class="bv-field wide"><span>Lien RoxxSolver <small>(facultatif : votre stuff comme départ)</small></span>
        <input name="roxx" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://roxxsolver.com/solver?build=…" value="${attr(f.roxx)}" /></label>
      <label class="bv-field"><span>Éléments</span><span class="select-wrap"><select name="elements">${opt('preset', 'Élément du preset', f.elements === 'preset')}${opt('all', 'Les quatre éléments', f.elements === 'all')}</select></span></label>
      <label class="bv-field"><span>Profil</span><span class="select-wrap"><select name="profile">${PROFILES.map(([v, l]) => opt(v, l, v === f.profile)).join('')}</select></span></label>
      <label class="bv-field"><span>Stuffs rendus</span><span class="select-wrap"><select name="top">${[1, 3, 5, 10].map(n => opt(n, `Top ${n}`, n === f.top)).join('')}</select></span></label>
      <label class="bv-field"><span>Recherche <small>(itérations)</small></span><span class="select-wrap"><select name="iterations">${SEARCH_EFFORTS.map(s => opt(s.iterations, s.label, s.iterations === f.iterations)).join('')}</select></span></label>
    </div>
    <div class="bv-actions">
      <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Calcul en cours…' : 'Calculer'}</button>
      <span class="bv-muted">≈ 1 s (rapide) à 10 s (poussée) par élément ; le serveur de développement calcule pendant ce temps.</span>
    </div>
  </form>`
}

// ───────────────────────────── résultat ─────────────────────────────

/** Score qui classe les stuffs (logJ du proxy ou logJ soutenu). */
const scoreOf = (r: StuffVsBossResult, e: StuffEvaluation) => (r.ranking.by === 'sustained' ? e.logJSustained : e.logJ)
const signed = (x: number, digits: number) => `${x >= 0 ? '+' : '−'}${fmtNum(Math.abs(x), digits)}`

/** Icônes des objets par id (fiches de tous les stuffs évalués). */
function iconMap(r: StuffVsBossResult): Map<number, number> {
  const out = new Map<number, number>()
  for (const e of [r.start, ...r.comparison, ...r.top, ...(r.elements ?? []).map(x => x.best)])
    for (const it of e.sheet?.items ?? []) if (it.iconId !== undefined && !out.has(it.itemId)) out.set(it.itemId, it.iconId)
  return out
}

function icon(it: { itemId: number; slotLabel: string }, icons: Map<number, number>): string {
  const id = icons.get(it.itemId)
  return `<span class="bv-icon" data-glyph="${attr(it.slotLabel.slice(0, 1))}">${
    id !== undefined ? `<img src="${ICON_URL(id)}" alt="" width="40" height="40" loading="lazy" decoding="async" />` : ''
  }</span>`
}

/** Tableau comparatif : départ, stuff du preset, génériques, puis optimisés. */
function comparison(r: StuffVsBossResult, sort: SortState | undefined): string {
  const seen = new Set<string>()
  const rows = [...r.comparison, ...r.top.filter(e => e.origin === 'optimized')].filter(e => !seen.has(e.id) && seen.add(e.id))
  const start = scoreOf(r, r.start)
  const sustained = r.ranking.by === 'sustained'
  const cols: Column<StuffEvaluation>[] = [
    {
      key: 'label',
      label: 'Stuff',
      sort: e => e.label,
      cell: e =>
        `<span class="bv-stuff-name${e.id === r.best.id ? ' best' : ''}">${esc(e.label)}${e.id === r.best.id ? ' <span class="bv-chip good">meilleur</span>' : ''}${e.valid ? '' : ' <span class="bv-chip bad">invalide</span>'}</span>`,
    },
    {
      key: 'score',
      label: sustained ? 'logJ soutenu' : 'logJ',
      num: true,
      title: 'Score de classement (comparable à personnage, rôle, profil et boss égaux) et écart au départ',
      sort: e => scoreOf(r, e) ?? -Infinity,
      cell: e => {
        const v = scoreOf(r, e)
        if (v === null) return '—'
        const d = start !== null && e.origin !== 'start' && e.origin !== 'user' ? ` <small class="${v - start >= 0 ? 'bv-up' : 'bv-down'}">${signed(v - start, 3)}</small>` : ''
        return `${fmtNum(v, 3)}${d}`
      },
    },
    { key: 'steady', label: 'DPT soutenu', num: true, sort: e => e.damage.steady, cell: e => fmtNum(e.damage.steady) },
    { key: 'proxy', label: 'DPT proxy', num: true, title: 'Objectif de l’optimiseur (un tour, × calibration du preset)', sort: e => e.damage.proxy, cell: e => fmtNum(e.damage.proxy) },
    { key: 'hp', label: 'PV', num: true, sort: e => e.survival.hp, cell: e => fmtNum(e.survival.hp) },
    { key: 'ehp', label: 'PVe', num: true, title: 'PV effectifs (* : plafonnés par l’objectif, voir les avertissements)', sort: e => e.survival.ehp, cell: e => `${fmtNum(e.survival.ehp)}${e.survival.capped ? '*' : ''}` },
    { key: 'inc', label: 'Reçus/tour', num: true, sort: e => e.survival.incoming, cell: e => fmtNum(e.survival.incoming) },
    { key: 'apmp', label: 'PA/PM/PO', num: true, sort: e => e.ap * 10000 + e.mp * 100 + e.range, cell: e => `${e.ap}/${e.mp}/${e.range}` },
    { key: 'pen', label: 'Pénalité', num: true, title: 'Facteur de l’objectif pour PA/PM/PO sous les valeurs visées', sort: e => e.penalty, cell: e => (e.penalty < 1 - 1e-9 ? `×${fmtNum(e.penalty, 3)}` : '—') },
  ]
  return `<section class="panel bv-card" aria-labelledby="bv-cmp-title">
    <header class="panel-head"><h2 id="bv-cmp-title">Comparaison</h2><span class="hint">${rows.length} stuffs évalués contre ce boss</span></header>
    ${sortableTable('stuff-cmp', cols, rows, sort, { rowAttrs: e => (e.id === r.best.id ? 'class="best"' : '') })}
    <p class="bv-note bv-pad">${esc(r.ranking.reason)} DPT soutenu : rotation établie, meilleure posture, non calibré. Pénalité : facteur de l’objectif pour PA/PM/PO sous les valeurs visées (${
      r.options.rangeNeed > 0 ? `${r.options.rangeNeed} PO ici` : `PO non exigée ici, joué ${esc(r.character.style.label)}`
    } ; détail dans les hypothèses), un réglage et non un effet du boss.</p>
  </section>`
}

/** Une ligne d'objet (icône, emplacement, nom, niveau, forgemagie). */
function itemRow(it: StuffItemLine, icons: Map<number, number>, isNew: boolean): string {
  return `<li class="bv-item${isNew ? ' new' : ''}">
    ${icon(it, icons)}
    <span class="bv-item-main">
      <small>${esc(it.slotLabel)}</small>
      <b>${esc(it.name)}</b>
      <span class="bv-item-meta">niv. ${it.level}${isNew ? ' · <span class="bv-chip good">nouveau</span>' : ''}${it.passive ? ' · <span class="bv-chip" title="Effet passif (1175) valorisé à 0 par le proxy">sort passif</span>' : ''}</span>
      ${it.forge.length ? `<span class="bv-forge">${it.forge.map(f => `<span>${esc(f)}</span>`).join('')}</span>` : ''}
    </span>
  </li>`
}

const PRIMARY_FR: Readonly<Record<string, string>> = { vitality: 'Vitalité', wisdom: 'Sagesse', strength: 'Force', intelligence: 'Intelligence', chance: 'Chance', agility: 'Agilité' }
function pointsText(p: Partial<Record<string, number>>): string {
  const parts = Object.entries(p)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${PRIMARY_FR[k] ?? k} ${fmtNum(v ?? 0)}`)
  return parts.length ? parts.join(', ') : 'aucun'
}

/** Meilleur stuff : résumé, objets, points, objets changés. */
function best(r: StuffVsBossResult, icons: Map<number, number>): string {
  const b = r.best
  const d = b.damage
  const added = new Set(b.changes.added.map(i => i.itemId))
  const gear = b.items.filter(i => i.slot !== 'dofus')
  const dofus = b.items.filter(i => i.slot === 'dofus')
  const v = scoreOf(r, b)
  const s0 = scoreOf(r, r.start)
  const kpi = (label: string, value: string, hint = '') => `<div class="bv-tile"${hint ? ` title="${attr(hint)}"` : ''}><small>${esc(label)}</small><b>${value}</b></div>`
  const changes =
    b.changes.added.length || b.changes.removed.length
      ? `<div class="bv-changes">
          <div><h4>Ajoutés</h4><ul class="bv-items compact">${b.changes.added.map(i => itemRow(i, icons, false)).join('') || '<li class="bv-muted">aucun</li>'}</ul></div>
          <div><h4>Retirés</h4><ul class="bv-items compact removed">${b.changes.removed.map(i => itemRow(i, icons, false)).join('') || '<li class="bv-muted">aucun</li>'}</ul></div>
        </div>`
      : '<p class="bv-muted">Aucun objet changé : le stuff de départ reste le meilleur.</p>'
  return `<section class="panel bv-card" aria-labelledby="bv-best-title">
    <header class="panel-head"><h2 id="bv-best-title">Meilleur stuff : ${esc(b.label)}</h2><span class="hint">${
      v !== null && s0 !== null && b.id !== r.start.id ? `${signed(v - s0, 3)} de ${r.ranking.by === 'sustained' ? 'logJ soutenu' : 'logJ'} par rapport au départ` : 'stuff de départ'
    }</span></header>
    <div class="bv-pad bv-stack">
      <div class="bv-tiles">
        ${kpi('DPT soutenu', fmtNum(d.steady), `Rafale ${fmtNum(d.burst)} ; posture « ${d.stance.name} »`)}
        ${kpi('DPT proxy', fmtNum(d.proxy))}
        ${kpi('PV', fmtNum(b.survival.hp))}
        ${kpi('PV effectifs', `${fmtNum(b.survival.ehp)}${b.survival.capped ? '*' : ''}`)}
        ${kpi('Reçus/tour', fmtNum(b.survival.incoming))}
        ${kpi('PA / PM / PO', `${b.ap} / ${b.mp} / ${b.range}`)}
      </div>
      <p class="bv-note">Posture « ${esc(d.stance.name)} » · rafale ${fmtNum(d.burst)} · élément ${esc(ELEMENT_FR[b.element] ?? b.element)}${b.valid ? '' : ' · <b>build invalide</b>'}${b.issues.length ? ` · ${esc(b.issues.join(' ; '))}` : ''}</p>
      <ul class="bv-items">${gear.map(i => itemRow(i, icons, added.has(i.itemId))).join('')}</ul>
      ${dofus.length ? `<h3 class="bv-subhead">Dofus et trophées</h3><ul class="bv-items">${dofus.map(i => itemRow(i, icons, added.has(i.itemId))).join('')}</ul>` : ''}
      <p class="bv-note">Points : ${esc(pointsText(b.points))}${b.pointsId && b.pointsId !== 'start' ? ` (répartition « ${esc(b.pointsId)} »)` : ''} · parchemins : ${esc(pointsText(b.scrolls))}</p>
      <h3 class="bv-subhead">Objets changés par rapport au départ</h3>
      ${changes}
    </div>
  </section>`
}

/** DPT soutenu par sort (rotation établie). */
function spells(r: StuffVsBossResult): string {
  const list = r.best.damage.spells
  return `<section class="panel bv-card" aria-labelledby="bv-spells-title">
    <header class="panel-head"><h2 id="bv-spells-title">DPT soutenu par sort</h2><span class="hint">lancers/tour × dégâts par lancer, résistances du boss</span></header>
    ${
      list.length
        ? `<div class="bv-scroll"><table class="bv-table">
        <thead><tr><th scope="col">Sort</th><th scope="col" class="num">PA</th><th scope="col" class="num">Lancers/tour</th><th scope="col" class="num">Dégâts/lancer</th><th scope="col" class="num">Dégâts/tour</th><th scope="col">Part</th></tr></thead>
        <tbody>${list
          .map(
            s => `<tr><th scope="row">${esc(s.name)}</th><td class="num">${s.apCost}</td><td class="num">${fmtNum(s.castsPerTurn, 2)}</td><td class="num">${fmtNum(s.damagePerCast)}</td><td class="num">${fmtNum(
              s.damagePerTurn,
            )}</td><td class="bv-part"><span class="bv-share"><i style="width:${(s.share * 100).toFixed(1)}%"></i></span> ${fmtPct(s.share * 100)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
        : '<p class="bv-pad bv-muted">Aucun sort ne fait de dégâts à ce boss dans ce modèle.</p>'
    }
  </section>`
}

/** Équivalences des caractéristiques contre ce boss. */
function weights(r: StuffVsBossResult): string {
  const w = r.statWeights
  const row = (e: (typeof w.items)[number]) =>
    `<tr><th scope="row">${esc(e.label)}</th><td>${esc(e.text)}</td><td class="num">${e.perRuneWeight !== null ? `×${fmtNum(e.perRuneWeight, 2)}` : '—'}</td></tr>`
  const head = '<thead><tr><th scope="col">Caractéristique</th><th scope="col">Équivalence</th><th scope="col" class="num" title="Valeur pour une même dépense de forgemagie, relative à la référence">Par poids de rune</th></tr></thead>'
  const first = w.items.slice(0, 10)
  const rest = w.items.slice(10)
  return `<section class="panel bv-card" aria-labelledby="bv-w-title">
    <header class="panel-head"><h2 id="bv-w-title">Équivalences des caractéristiques</h2><span class="hint">référence : ${esc(w.referenceLabel)}</span></header>
    <div class="bv-scroll"><table class="bv-table bv-weights">${head}<tbody>${first.map(row).join('')}</tbody></table></div>
    ${rest.length ? `<details class="bv-more"><summary>${rest.length} autres caractéristiques</summary><div class="bv-scroll"><table class="bv-table bv-weights">${head}<tbody>${rest.map(row).join('')}</tbody></table></div></details>` : ''}
    ${w.notes.length ? `<ul class="bv-notes">${w.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </section>`
}

/** Autres stuffs du top et comparaison des éléments. */
function others(r: StuffVsBossResult, icons: Map<number, number>): string {
  const list = r.top.filter(e => e.id !== r.best.id)
  const top = list.length
    ? `<section class="panel bv-card" aria-labelledby="bv-top-title">
      <header class="panel-head"><h2 id="bv-top-title">Autres stuffs du top</h2><span class="hint">objets changés par rapport au départ</span></header>
      <ul class="bv-others">${list
        .map(e => {
          const v = scoreOf(r, e)
          return `<li><div><b>${esc(e.label)}</b> <span class="bv-muted">${v === null ? '' : `score ${fmtNum(v, 3)} · `}DPT soutenu ${fmtNum(e.damage.steady)} · PVe ${fmtNum(e.survival.ehp)}</span></div>
            <div class="bv-swaps">${e.changes.added.map(i => `<span class="bv-swap add" title="${attr(i.slotLabel)}">${icon(i, icons)}+ ${esc(i.name)}</span>`).join('')}${e.changes.removed
              .map(i => `<span class="bv-swap del" title="${attr(i.slotLabel)}">${icon(i, icons)}− ${esc(i.name)}</span>`)
              .join('')}${e.changes.added.length || e.changes.removed.length ? '' : '<span class="bv-muted">aucun objet changé</span>'}</div></li>`
        })
        .join('')}</ul>
    </section>`
    : ''
  const els = r.elements?.length
    ? `<section class="panel bv-card" aria-labelledby="bv-els-title">
      <header class="panel-head"><h2 id="bv-els-title">Comparaison des éléments</h2><span class="hint">une recherche par élément</span></header>
      <div class="bv-scroll"><table class="bv-table"><thead><tr><th scope="col">Élément</th><th scope="col" class="num">Rés. du boss</th><th scope="col" class="num">Score</th><th scope="col" class="num">DPT soutenu</th><th scope="col" class="num">PVe</th><th scope="col"></th></tr></thead>
      <tbody>${r.elements
        .map(e => {
          const v = scoreOf(r, e.best)
          return `<tr${e.chosen ? ' class="best"' : ''}><th scope="row">${elementChip(ELEMENT_INDEX[e.element] ?? 0)}</th><td class="num">${fmtPct(e.bossResPct)}</td><td class="num">${v === null ? '—' : fmtNum(v, 3)}</td><td class="num">${fmtNum(
            e.best.damage.steady,
          )}</td><td class="num">${fmtNum(e.best.survival.ehp)}</td><td>${e.chosen ? '<span class="bv-chip good">retenu</span>' : ''}</td></tr>`
        })
        .join('')}</tbody></table></div>
    </section>`
    : ''
  return els + top
}

/** Résultat complet. */
export function renderStuffResult(r: StuffVsBossResult, sort: SortState | undefined): string {
  const icons = iconMap(r)
  const c = r.character
  const s = r.search
  return `<p class="bv-lead">${esc(c.className)} niveau ${c.level} · preset <code>${esc(c.presetId)}</code> (${esc(c.presetLabel)}) · rôle ${esc(c.roleLabel)} · ${esc(c.elementLabel)} · ${esc(
    c.style.label,
  )}${c.input !== 'preset' ? ` · départ : ${c.input === 'roxx' ? 'votre lien RoxxSolver' : 'votre build'}` : ''}</p>
    ${c.style.reason ? `<p class="bv-note">Joué ${esc(c.style.label)} : ${esc(c.style.reason)} — ${r.options.rangeNeed > 0 ? `${r.options.rangeNeed} PO visées` : 'PO non exigée'}${c.style.contact && !c.style.mismatch ? ', % dommages mêlée valorisés' : ''}.</p>` : ''}
    ${best(r, icons)}
    ${comparison(r, sort)}
    ${others(r, icons)}
    <div class="bv-grid">${spells(r)}${weights(r)}</div>
    ${foldList('Avertissements', r.warnings, 'warn', r.warnings.some(w => !w.startsWith('Boss :')))}
    ${foldList('Hypothèses', r.assumptions)}
    <p class="bv-note">Recherche : ${s.runs} recherche(s) de ${fmtNum(r.options.iterations)} itérations, ${fmtNum(s.ms / 1000, 1)} s, ${fmtNum(s.evaluations.surrogate)} évaluations (forme fermée) + ${fmtNum(
      s.evaluations.exact,
    )} exactes ; graines : ${esc(s.seedStuffs.join(', ') || 'départ et glouton seulement')}.</p>`
}
