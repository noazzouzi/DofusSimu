/**
 * Panneaux DOM : ordre de jeu, détails d'un combattant, journal, marqueurs de la barre de
 * lecture, bannières de la scène et écran de résultat.
 */
import { formatInt } from '@/replay/log'
import type { ReplayTimeline } from '@/replay/reducer'
import type { FighterView, LogEntry, LogSeg, Replay, ViewState } from '@/replay/types'
import { initials } from '../render/renderer'

export const BREED_NAMES: Record<number, string> = {
  1: 'Féca',
  2: 'Osamodas',
  3: 'Enutrof',
  4: 'Sram',
  5: 'Xélor',
  6: 'Écaflip',
  7: 'Eniripsa',
  8: 'Iop',
  9: 'Crâ',
  10: 'Sadida',
  11: 'Sacrieur',
  12: 'Pandawa',
  13: 'Roublard',
  14: 'Zobal',
  15: 'Steamer',
  16: 'Eliotrope',
  17: 'Huppermage',
  18: 'Ouginak',
  20: 'Forgelance',
}

const ELEMENT_VARS = ['--el-neutral', '--el-earth', '--el-fire', '--el-water', '--el-air']

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function hpClass(f: FighterView): string {
  const r = f.hp / Math.max(1, f.maxHp)
  return r > 0.5 ? '' : r > 0.25 ? 'mid' : 'low'
}

function kindLabel(f: FighterView): string {
  if (f.kind === 'player') return f.breedId !== undefined ? (BREED_NAMES[f.breedId] ?? `Classe #${f.breedId}`) : 'Personnage'
  if (f.kind === 'summon') return 'Invocation'
  return f.boss ? 'Boss' : 'Monstre'
}

// ───────────────────────────── ordre de jeu ─────────────────────────────

export class TurnOrderPanel {
  private cards = new Map<number, HTMLButtonElement>()
  private ids = ''

  constructor(
    private readonly el: HTMLElement,
    private readonly onSelect: (id: number) => void,
  ) {
    el.addEventListener('click', e => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.to-card')
      if (card) this.onSelect(Number(card.dataset.id))
    })
  }

  reset(): void {
    this.cards.clear()
    this.ids = ''
    this.el.innerHTML = ''
  }

  update(order: number[], state: ViewState, selected: number | null): void {
    const key = order.join(',')
    if (key !== this.ids) {
      this.ids = key
      this.el.innerHTML = ''
      for (const id of order) {
        let card = this.cards.get(id)
        if (!card) {
          card = document.createElement('button')
          card.type = 'button'
          card.className = 'to-card'
          card.dataset.id = String(id)
          card.innerHTML = '<span class="marker"></span><span class="badge"></span><span class="to-avatar"></span><span class="to-name"></span><span class="to-hp"><i></i><b></b></span><span class="to-num"></span>'
          this.cards.set(id, card)
        }
        this.el.appendChild(card)
      }
    }
    const byId = new Map(state.fighters.map(f => [f.id, f]))
    for (const id of order) {
      const f = byId.get(id)
      const card = this.cards.get(id)
      if (!f || !card) continue
      card.className = `to-card team${f.team}${f.kind === 'summon' ? ' summon' : ''}${f.boss ? ' boss' : ''}${f.alive ? '' : ' dead'}${state.current === id && !state.ended ? ' current' : ''}${selected === id ? ' selected' : ''}`
      card.title = `${f.name} — ${formatInt(f.hp)} / ${formatInt(f.maxHp)} PV${f.shield ? ` (+${formatInt(f.shield)} bouclier)` : ''}`
      ;(card.querySelector('.to-avatar') as HTMLElement).textContent = initials(f.name)
      ;(card.querySelector('.to-name') as HTMLElement).textContent = f.name
      ;(card.querySelector('.badge') as HTMLElement).textContent = f.wave && f.wave > 1 ? `V${f.wave}` : ''
      const bar = card.querySelector('.to-hp i') as HTMLElement
      bar.style.width = `${(100 * f.hp) / Math.max(1, f.baseMaxHp)}%`
      bar.className = hpClass(f)
      ;(card.querySelector('.to-hp b') as HTMLElement).style.width = `${Math.min(100, (100 * f.shield) / Math.max(1, f.maxHp))}%`
      ;(card.querySelector('.to-num') as HTMLElement).textContent = f.alive ? formatInt(f.hp) : 'K.O.'
    }
  }
}

// ───────────────────────────── détails ─────────────────────────────

export function renderDetails(el: HTMLElement, f: FighterView | undefined, state: ViewState, tl: ReplayTimeline, replay: Replay, follow: boolean): void {
  if (!f) {
    const team = replay.meta?.team ?? []
    el.innerHTML = `
      <div class="d-section">
        <h4>Combattant</h4>
        <p class="empty">Touchez un combattant sur la carte ou dans l’ordre de jeu pour afficher ses caractéristiques, ses effets et ses statistiques de combat.</p>
      </div>
      ${
        team.length
          ? `<div class="d-section"><h4>Composition</h4><dl class="kv">${team
              .map(m => `<dt>${esc(m.name)}${m.role ? ` · ${esc(m.role)}` : ''}</dt><dd>${esc(m.build ?? m.breed ?? '')}</dd>`)
              .join('')}</dl></div>`
          : ''
      }`
    return
  }
  const info = replay.meta?.fighters?.[String(f.id)]
  const isCur = state.current === f.id && state.turnActive
  const sub = [kindLabel(f), `niv. ${f.level}`, f.role && !/boss/i.test(f.role) ? f.role : '', f.wave ? `vague ${f.wave}` : '']
    .filter(Boolean)
    .join(' · ')
  const summoner = f.summonerId !== undefined ? state.fighters.find(x => x.id === f.summonerId) : undefined
  const eroded = f.baseMaxHp - f.maxHp
  const hpPct = (100 * f.hp) / Math.max(1, f.baseMaxHp)
  const erosionPct = (100 * eroded) / Math.max(1, f.baseMaxHp)
  const buffs = f.buffs
    .map(b => {
      const src = state.fighters.find(x => x.id === b.sourceId)
      const dur = b.remaining < 0 ? 'permanent' : b.remaining === 0 ? '' : `${b.remaining} t.`
      return `<span class="pill" title="${src ? 'Lancé par ' + esc(src.name) : ''}">${esc(b.label)}${dur ? ` <small>${dur}</small>` : ''}</span>`
    })
    .join('')
  const states = f.states.map(s => `<span class="pill state">${esc(s.name)}</span>`).join('')
  const m = f.metrics
  const killer = f.killer !== undefined ? state.fighters.find(x => x.id === f.killer) : undefined
  const extraStats = info?.stats
    ? `<div class="d-section"><h4>Caractéristiques</h4><dl class="kv">${Object.entries(info.stats)
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'number' ? formatInt(v) : String(v))}</dd>`)
        .join('')}</dl></div>`
    : ''
  const spells = info?.spells?.length ? `<div class="d-section"><h4>Sorts</h4><div class="pills">${info.spells.map(s => `<span class="pill">${esc(s)}</span>`).join('')}</div></div>` : ''
  const equipment = info?.equipment?.length
    ? `<div class="d-section"><h4>Équipement</h4><div class="pills">${info.equipment.map(s => `<span class="pill">${esc(s)}</span>`).join('')}</div></div>`
    : ''
  el.innerHTML = `
    <div class="d-head">
      <div class="d-avatar team${f.team}${f.boss ? ' boss' : ''}">${esc(initials(f.name))}</div>
      <div class="d-title">
        <h3>${esc(f.name)}
          ${f.boss ? '<span class="tag boss">Boss</span>' : ''}
          ${!f.alive ? '<span class="tag dead">Vaincu</span>' : ''}
          ${isCur ? '<span class="tag turn">Joue</span>' : follow ? '' : ''}
        </h3>
        <p>${esc(sub)}${summoner ? ` · invoqué par ${esc(summoner.name)}` : ''}</p>
      </div>
    </div>
    <div class="d-bars">
      <div class="bar"><i class="${hpClass(f)}" style="width:${hpPct}%"></i>${erosionPct > 0.2 ? `<em style="width:${erosionPct}%"></em>` : ''}
        <span>${formatInt(f.hp)} / ${formatInt(f.maxHp)} PV${eroded > 0 ? ` · érosion ${formatInt(eroded)}` : ''}</span></div>
      ${f.shield > 0 ? `<div class="bar shield" title="Bouclier : ${formatInt(f.shield)}"><i style="width:${Math.min(100, (100 * f.shield) / Math.max(1, f.maxHp))}%"></i></div>` : ''}
    </div>
    <div class="d-stats">
      <div class="stat ap"><small>PA</small><b>${f.ap}</b><small>/ ${f.apMax}</small></div>
      <div class="stat mp"><small>PM</small><b>${f.mp}</b><small>/ ${f.mpMax}</small></div>
      <div class="stat"><small>Bouclier</small><b>${formatInt(f.shield)}</b></div>
      <div class="stat"><small>Cellule</small><b>${f.alive ? f.cell : '—'}</b></div>
    </div>
    ${states ? `<div class="d-section"><h4>États</h4><div class="pills">${states}</div></div>` : ''}
    <div class="d-section"><h4>Effets actifs</h4>${buffs ? `<div class="pills">${buffs}</div>` : '<p class="empty">Aucun effet.</p>'}</div>
    <div class="d-section"><h4>Bilan du combat</h4><dl class="kv">
      <dt>Dommages infligés</dt><dd>${formatInt(m.damageDealt)}</dd>
      <dt>Dommages subis</dt><dd>${formatInt(m.damageTaken)}</dd>
      ${m.healingDone ? `<dt>Soins prodigués</dt><dd>${formatInt(m.healingDone)}</dd>` : ''}
      ${m.shieldGiven ? `<dt>Boucliers donnés</dt><dd>${formatInt(m.shieldGiven)}</dd>` : ''}
      ${m.apRemoved || m.mpRemoved ? `<dt>Retraits PA / PM</dt><dd>${m.apRemoved} / ${m.mpRemoved}</dd>` : ''}
      <dt>Éliminations</dt><dd>${m.kills}</dd>
      <dt>Tours joués</dt><dd>${m.turnsPlayed}</dd>
      ${killer ? `<dt>Vaincu par</dt><dd>${esc(killer.name)}</dd>` : ''}
    </dl></div>
    ${extraStats}${spells}${equipment}
    ${info?.notes ? `<div class="d-section"><h4>Notes</h4><p class="empty">${esc(info.notes)}</p></div>` : ''}
    ${follow ? '<p class="empty">Suit le combattant actif — touchez un autre combattant pour le figer.</p>' : ''}`
  void tl
}

// ───────────────────────────── journal ─────────────────────────────

function segHtml(s: LogSeg): string {
  const t = esc(s.text)
  const cls: string[] = []
  if (s.team !== undefined) cls.push(`f${s.team}`)
  if (s.style === 'damage') cls.push('dmg')
  else if (s.style) cls.push(s.style)
  const dot = s.style === 'damage' && s.element !== undefined ? `<i class="el" style="background:var(${ELEMENT_VARS[s.element]})"></i>` : ''
  return cls.length ? `<span class="${cls.join(' ')}">${dot}${t}</span>` : t
}

/**
 * Journal fenêtré : seules les dernières lignes visibles (≈ 160, extensible avec « lignes
 * précédentes ») sont dans le DOM, créées à la demande et réutilisées. Un replay de 20 000
 * événements (≈ 10 000 lignes) reste ainsi fluide pendant le défilement et la lecture rapide.
 */
export class LogPanel {
  static readonly WINDOW = 160
  private entries: LogEntry[] = []
  private nodes: (HTMLLIElement | undefined)[] = []
  /** Lignes affichées : [start, end). */
  private start = 0
  private end = 0
  /** Lignes supplémentaires demandées au-delà de la fenêtre. */
  private extra = 0
  private lastEvent = 0
  private stick = true
  private readonly more: HTMLLIElement
  private nowEls: HTMLLIElement[] = []

  constructor(
    private readonly el: HTMLOListElement,
    private readonly onPick: (index: number) => void,
  ) {
    this.more = document.createElement('li')
    this.more.className = 'more'
    this.more.setAttribute('role', 'button')
    this.more.tabIndex = 0
    el.addEventListener('click', e => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li')
      if (li === this.more) this.showEarlier()
      else if (li?.dataset.i) this.onPick(Number(li.dataset.i))
    })
    this.more.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        this.showEarlier()
      }
    })
    el.addEventListener('scroll', () => {
      this.stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
    }, { passive: true })
  }

  load(entries: LogEntry[]): void {
    this.entries = entries
    this.nodes = new Array(entries.length)
    this.el.replaceChildren()
    this.start = this.end = this.extra = 0
    this.nowEls = []
    this.stick = true
  }

  private node(k: number): HTMLLIElement {
    let li = this.nodes[k]
    if (!li) {
      const e = this.entries[k]
      li = document.createElement('li')
      li.className = `${e.tone} d${e.depth}`
      li.dataset.i = String(e.index)
      li.innerHTML = e.segs.map(segHtml).join('')
      this.nodes[k] = li
    }
    return li
  }

  private range(a: number, b: number): HTMLLIElement[] {
    const out: HTMLLIElement[] = []
    for (let k = a; k < b; k++) out.push(this.node(k))
    return out
  }

  private showEarlier(): void {
    // La ligne visible reste à sa place (ancrage dans render) : le contenu est ajouté au-dessus.
    this.stick = false
    this.extra += LogPanel.WINDOW
    this.render(this.end)
  }

  private render(count: number): void {
    const start = Math.max(0, count - LogPanel.WINDOW - this.extra)
    if (start === this.start && count === this.end) return
    const el = this.el
    // Lecteur remonté dans le journal : garder la ligne lue à la même place quand la fenêtre glisse.
    let anchor: HTMLElement | null = null
    let anchorTop = 0
    if (!this.stick && this.end > 0) {
      for (const child of el.children) {
        const c = child as HTMLElement
        if (c !== this.more && c.offsetTop + c.offsetHeight > el.scrollTop) {
          anchor = c
          anchorTop = c.offsetTop
          break
        }
      }
    }
    if (this.more.parentNode) this.more.remove()
    if (start >= this.end || count <= this.start || this.end === 0) {
      el.replaceChildren(...this.range(start, count))
    } else {
      for (let k = this.start; k < Math.min(start, this.end); k++) this.nodes[k]?.remove()
      for (let k = Math.max(count, this.start); k < this.end; k++) this.nodes[k]?.remove()
      if (start < this.start) el.prepend(...this.range(start, this.start))
      if (count > this.end) el.append(...this.range(Math.max(this.end, start), count))
    }
    this.start = start
    this.end = count
    if (start > 0) {
      this.more.textContent = `▲ ${formatInt(Math.min(LogPanel.WINDOW, start))} lignes précédentes (${formatInt(start)} masquées)`
      el.prepend(this.more)
    }
    if (anchor?.isConnected) el.scrollTop += anchor.offsetTop - anchorTop
  }

  update(count: number, eventIndex: number): void {
    // Un saut lointain dans la chronologie revient à la fenêtre normale.
    if (Math.abs(eventIndex - this.lastEvent) > 400) this.extra = 0
    this.lastEvent = eventIndex
    this.render(count)
    for (const li of this.nowEls) li.classList.remove('now')
    this.nowEls = []
    // Surligne les lignes de la dernière action (depuis la dernière ligne de niveau 0).
    let k = count - 1
    while (k >= this.start && this.entries[k].depth === 1) k--
    if (k >= this.start && eventIndex - this.entries[k].index < 40) {
      for (let j = k; j < count; j++) {
        const li = this.node(j)
        li.classList.add('now')
        this.nowEls.push(li)
      }
    }
    if (this.stick && count > 0) this.el.scrollTop = this.el.scrollHeight
  }
}

// ───────────────────────────── barre de lecture ─────────────────────────────

export function renderMarkers(el: HTMLElement, tl: ReplayTimeline): void {
  const n = Math.max(1, tl.length - 1)
  const rounds = tl.markers.filter(m => m.kind === 'round').length
  // Étiquettes « T12 » : au plus une tous les ~44 px pour qu'elles ne se chevauchent pas.
  const maxLabels = Math.max(2, Math.floor((el.clientWidth || 600) / 44))
  const every = Math.max(1, Math.ceil(rounds / maxLabels))
  let r = 0
  el.innerHTML = tl.markers
    .map(m => {
      const left = `${(100 * m.index) / n}%`
      if (m.kind === 'round') {
        r++
        const label = r % every === 0 || r === 1 ? `<span>${esc(m.label.replace('Tour ', 'T'))}</span>` : ''
        return `<div class="m round" style="left:${left}" title="${esc(m.label)}">${label}</div>`
      }
      if (m.kind === 'death') return `<div class="m death t${m.team ?? 1}" style="left:${left}" title="${esc(m.label)}"></div>`
      return `<div class="m ${m.kind}" style="left:${left}" title="${esc(m.label)}"></div>`
    })
    .join('')
}

// ───────────────────────────── résultat ─────────────────────────────

export function renderResult(el: HTMLElement, state: ViewState, onReplay: () => void, onClose: () => void): void {
  const end = state.ended
  if (!end) {
    el.hidden = true
    return
  }
  const cls = end.winner === 0 ? 'win' : end.winner === 1 ? 'lose' : ''
  const title = end.winner === 0 ? 'Victoire !' : end.winner === 1 ? 'Défaite' : 'Match nul'
  const rows = state.fighters
    .slice()
    .sort((a, b) => a.team - b.team || b.metrics.damageDealt - a.metrics.damageDealt)
    .map(
      f => `<tr class="${f.alive ? '' : 'dead'}"><td><span class="${f.team === 0 ? 'f0' : 'f1'}">${esc(f.name)}</span></td>
        <td>${formatInt(f.metrics.damageDealt)}</td><td>${formatInt(f.metrics.damageTaken)}</td><td>${formatInt(f.metrics.healingDone)}</td><td>${f.metrics.kills}</td></tr>`,
    )
    .join('')
  el.innerHTML = `
    <div class="result-card ${cls}" role="dialog" aria-label="Résultat du combat">
      <h2>${title}</h2>
      <p class="sub">${end.rounds} tour${end.rounds > 1 ? 's' : ''} · ${esc(end.reason)}</p>
      <div class="result-scroll">
        <table class="result-table">
          <thead><tr><th>Combattant</th><th>Infligés</th><th>Subis</th><th>Soins</th><th>K.O.</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="result-actions">
        <button type="button" class="btn" data-act="close">Fermer</button>
        <button type="button" class="btn primary" data-act="replay">Revoir le combat</button>
      </div>
    </div>`
  el.hidden = false
  el.querySelector('[data-act="replay"]')!.addEventListener('click', onReplay)
  el.querySelector('[data-act="close"]')!.addEventListener('click', onClose)
}
