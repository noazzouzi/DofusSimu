/**
 * Section « Boss » — rendu de la fiche du boss (`BossProfileDetail`, src/theorycraft/bossProfile.ts) : caractéristiques,
 * résistances brutes et effectives en barres aux couleurs des éléments, éléments du plus faible au plus fort, profil
 * offensif par phase (pic, soutenu, parts élémentaires), mécaniques (ce qui y répond, ce qu'elles punissent), sorts du
 * boss, avertissements et hypothèses repliables. HTML seulement : rien n'est recalculé ici.
 */
import type { BossEntry, BossProfileDetail } from './boss-api'
import { attr, elClass, elementChip, ELEMENT_LABELS, esc, fmtNum, fmtPct, foldList, mechanicLabel, shareBar, tagLabel } from './boss-ui'

/** Statistique en tuile. */
const tile = (label: string, value: string, hint = '') =>
  `<div class="bv-tile"${hint ? ` title="${attr(hint)}"` : ''}><small>${esc(label)}</small><b>${value}</b></div>`

/** Résistances brutes (grade) et effectives (sort de départ, fiche manuelle), barres sur un axe commun. */
function resistances(p: BossProfileDetail): string {
  const values = [...p.rawResPct, ...p.resPct]
  const lo = Math.min(0, ...values)
  const hi = Math.max(100, ...values)
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100
  const zero = pos(0)
  const bar = (v: number, cls: string) => {
    const a = Math.min(pos(v), zero)
    const w = Math.abs(pos(v) - zero)
    return `<i class="${cls}${v < 0 ? ' neg' : ''}" style="left:${a.toFixed(2)}%;width:${w.toFixed(2)}%"></i>`
  }
  const rows = ELEMENT_LABELS.map((label, i) => {
    const raw = p.rawResPct[i]
    const eff = p.resPct[i]
    const changed = raw !== eff
    return `<li class="${elClass(i)}">
      <span class="bv-res-name"><i aria-hidden="true"></i>${esc(label)}</span>
      <span class="bv-res-track" role="img" aria-label="${attr(`${label} : effective ${fmtPct(eff)}${changed ? `, brute ${fmtPct(raw)}` : ''}`)}">
        ${zero > 0 ? `<span class="bv-res-zero" style="left:${zero.toFixed(2)}%"></span>` : ''}
        ${changed ? bar(raw, 'raw') : ''}${bar(eff, 'eff')}
      </span>
      <span class="bv-res-val"><b>${fmtPct(eff)}</b>${changed ? `<small>brute ${fmtPct(raw)}</small>` : ''}</span>
    </li>`
  }).join('')
  const st = p.stats
  const extra = [
    st.rangedResPct ? `Distance ${fmtPct(st.rangedResPct)}` : '',
    st.meleeResPct ? `Mêlée ${fmtPct(st.meleeResPct)}` : '',
    st.spellResPct ? `Sorts ${fmtPct(st.spellResPct)}` : '',
    st.finalDamagePct ? `Dommages finaux ${st.finalDamagePct > 0 ? '+' : ''}${fmtPct(st.finalDamagePct)}` : '',
  ].filter(Boolean)
  const differs = p.rawResPct.some((v, i) => v !== p.resPct[i])
  return `<section class="panel bv-card" aria-labelledby="bv-res-title">
    <header class="panel-head"><h2 id="bv-res-title">Résistances</h2><span class="hint">${differs ? 'effectives (barre pleine) et brutes du grade (trait)' : 'effectives = brutes du grade'}</span></header>
    <div class="bv-pad">
      <ul class="bv-res">${rows}</ul>
      ${extra.length ? `<p class="bv-line"><span class="bv-label">Réductions et bonus effectifs</span>${extra.map(x => `<span class="bv-chip">${esc(x)}</span>`).join('')}</p>` : ''}
      <p class="bv-line"><span class="bv-label">Du plus faible au plus fort</span>${p.weakestElements.map(i => elementChip(i, fmtPct(p.resPct[i]))).join('<span class="bv-sep" aria-hidden="true">‹</span>')}</p>
    </div>
  </section>`
}

const vulnerableText = (v: boolean | 'melee' | 'range') => (v === true ? 'oui' : v === 'melee' ? 'mêlée seule' : v === 'range' ? 'distance seule' : 'non')

/** Profil offensif par phase et répartition des dégâts reçus. */
function offense(p: BossProfileDetail): string {
  const rows = p.phases
    .map(
      ph => `<tr>
        <th scope="row">${esc(ph.name)}${ph.states.length ? `<small class="bv-muted"> états ${ph.states.map(String).join(', ')}</small>` : ''}</th>
        <td class="num">${fmtPct(ph.weight * 100)}</td>
        <td>${vulnerableText(ph.vulnerable)}</td>
        <td class="num">${fmtNum(ph.peakPerTurn)}</td>
        <td class="num">${fmtNum(ph.sustainedPerTurn)}</td>
        <td class="bv-share-cell">${shareBar(ph.elementShares)}</td>
      </tr>`,
    )
    .join('')
  return `<section class="panel bv-card" aria-labelledby="bv-off-title">
    <header class="panel-head"><h2 id="bv-off-title">Profil offensif</h2><span class="hint">un tour du boss sur un joueur à 0 % de résistance</span></header>
    <div class="bv-scroll"><table class="bv-table">
      <thead><tr><th scope="col">Phase</th><th scope="col" class="num">Poids</th><th scope="col">Attaquable</th><th scope="col" class="num" title="Meilleure combinaison de sorts sur une cible en un tour : optimiste pour une cible, mais zones, sorts en réaction et invocations non comptés (le total peut être sous-estimé)">Pic/tour</th><th scope="col" class="num" title="Relances amorties">Soutenu/tour</th><th scope="col">Éléments</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="bv-pad bv-incoming"><span class="bv-label">Dégâts reçus, phases pondérées</span>${shareBar(p.incomingShares, true)}</div>
  </section>`
}

/** Mécaniques détectées (données) ou décrites (fiche manuelle). */
function mechanics(p: BossProfileDetail): string {
  const items = p.mechanics
    .map(
      m => `<li>
        <div class="bv-mech-head"><span class="bv-kind">${esc(mechanicLabel(m.kind))}</span>${m.source === 'overrides' ? '<span class="bv-chip manual">fiche manuelle</span>' : ''}</div>
        <p>${esc(m.summary)}</p>
        ${
          m.counters?.length || m.punishes?.length
            ? `<p class="bv-tags">${(m.counters ?? []).map(t => `<span class="bv-chip good" title="Répond à la mécanique">contre : ${esc(tagLabel(t))}</span>`).join('')}${(m.punishes ?? [])
                .map(t => `<span class="bv-chip bad" title="Neutralisé ou puni par la mécanique">punit : ${esc(tagLabel(t))}</span>`)
                .join('')}</p>`
            : ''
        }
      </li>`,
    )
    .join('')
  return `<section class="panel bv-card" aria-labelledby="bv-mech-title">
    <header class="panel-head"><h2 id="bv-mech-title">Mécaniques</h2><span class="hint">${p.mechanics.length} détectée${p.mechanics.length > 1 ? 's' : ''}</span></header>
    ${p.mechanics.length ? `<ul class="bv-mechs">${items}</ul>` : '<p class="bv-pad bv-muted">Aucune mécanique détectée dans les données.</p>'}
  </section>`
}

const FLAG_LABELS: Readonly<Record<string, string>> = {
  'hp-based': '% de PV',
  delayed: 'différé',
  triggered: 'déclenché',
  positional: 'positionnel',
  'ring-excludes-target': 'anneau',
  summon: 'invocation',
  mark: 'glyphe/piège',
  'sub-spell': 'sous-sort',
  excluded: 'exclu',
}

/** Sorts du boss (repliable) : PA, lancers, relance, dégâts par élément, drapeaux. */
function spells(p: BossProfileDetail): string {
  if (!p.spells.length) return ''
  const rows = p.spells
    .map(
      s => `<tr>
        <th scope="row">${esc(s.name)} <small class="bv-muted">${s.spellId}</small></th>
        <td class="num">${s.apCost}</td>
        <td class="num">${s.castsPerTurn ? s.castsPerTurn : '∞'}</td>
        <td class="num">${s.cooldown}</td>
        <td class="num">${s.range}</td>
        ${s.damageByElement.map((v, i) => `<td class="num ${v > 0 ? `bv-dmg ${elClass(i)}` : 'bv-muted'}">${v > 0 ? fmtNum(v) : '—'}</td>`).join('')}
        <td class="num">${s.otherDamage > 0 ? fmtNum(s.otherDamage) : '—'}</td>
        <td>${[...(s.requiredStates.length ? [`états ${s.requiredStates.join(', ')}`] : []), ...s.flags.map(f => FLAG_LABELS[f] ?? f)].map(x => `<span class="bv-chip">${esc(x)}</span>`).join('')}</td>
      </tr>`,
    )
    .join('')
  return `<details class="panel bv-fold">
    <summary><span>Sorts du boss</span><span class="bv-count">${p.spells.length}</span></summary>
    <p class="bv-note">Dégâts moyens par lancer contre 0 % de résistance (critique pondéré, sous-sorts compris)${p.startingSpell ? ` ; sort de départ : ${esc(p.startingSpell.name)} (${p.startingSpell.spellId})` : ''}.</p>
    <div class="bv-scroll"><table class="bv-table bv-spells">
      <thead><tr><th scope="col">Sort</th><th scope="col" class="num">PA</th><th scope="col" class="num">Lancers</th><th scope="col" class="num">Relance</th><th scope="col" class="num">PO</th>${ELEMENT_LABELS.map(
        (l, i) => `<th scope="col" class="num"><span class="bv-el-dot ${elClass(i)}" aria-hidden="true"></span>${esc(l)}</th>`,
      ).join('')}<th scope="col" class="num">Autre</th><th scope="col">Conditions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details>`
}

/** Fiche manuelle appliquée (data/bosses/<id>.json) : version du jeu, sources citées, notes. */
function manual(p: BossProfileDetail): string {
  const o = p.overrides
  if (!o) return ''
  const sources = (o.sources ?? [])
    .map(s => {
      const safe = /^https?:\/\//i.test(s.url)
      const label = esc(s.url)
      return `<li>${safe ? `<a href="${attr(s.url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label}${s.date ? ` — consulté le ${esc(s.date)}` : ''}${s.patch ? ` (version ${esc(s.patch)})` : ''}</li>`
    })
    .join('')
  return `<details class="panel bv-fold"><summary><span>Fiche manuelle</span><code>data/bosses/${o.monsterId}.json</code></summary>
    <div class="bv-pad bv-manual">
      <p class="bv-note">${o.updatedAt ? `Mise à jour le ${esc(o.updatedAt)}` : 'Date de mise à jour non renseignée'}${o.patch ? ` · version du jeu ${esc(o.patch)}` : ''}.</p>
      ${sources ? `<h4>Sources</h4><ul>${sources}</ul>` : '<p class="bv-note">Aucune source citée.</p>'}
      ${o.notes ? `<h4>Notes</h4><p>${esc(o.notes)}</p>` : ''}
    </div></details>`
}

/** Fiche complète (onglet « Fiche »). */
export function renderSheet(p: BossProfileDetail, entry: BossEntry | undefined): string {
  const dungeons = entry?.dungeons ?? []
  return `<div class="bv-sheet">
    <section class="bv-tiles" aria-label="Caractéristiques">
      ${tile('PV', fmtNum(p.hp))}
      ${tile('PA', String(p.ap))}
      ${tile('PM', String(p.mp))}
      ${tile('Niveau', String(p.level))}
      ${tile('Esquive PA/PM', `${fmtNum(p.apParry)} / ${fmtNum(p.mpParry)}`, 'Esquive des retraits de PA et de PM')}
      ${tile('Tacle', fmtNum(p.tackle))}
    </section>
    ${dungeons.length > 1 ? `<p class="bv-note">Présent dans : ${dungeons.map(d => `${esc(d.name)} (niv. ${d.level}${d.isExpedition ? ', Expédition' : ''})`).join(' · ')}.</p>` : ''}
    <div class="bv-grid">
      ${resistances(p)}
      ${offense(p)}
    </div>
    ${mechanics(p)}
    ${spells(p)}
    ${foldList('Avertissements', p.warnings, 'warn')}
    ${foldList('Hypothèses', p.assumptions)}
    ${manual(p)}
  </div>`
}
