/**
 * Sélecteur d'objet de l'éditeur de stuff (section « Stuffs ») : boîte de dialogue, recherche par nom ou panoplie
 * (accents ignorés), filtre de niveau, aperçu des effets. Entrée choisit le premier résultat, Échap ferme.
 */
import type { CatalogItem } from '@/optimizer/team/editor'
import type { EquipmentSlot } from '@/data/model'
import { esc } from './ui/panels'

const ICON_URL = (iconId: number) => `https://api.dofusdb.fr/img/items/${iconId}.png`
const MAX_RESULTS = 80
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface PickRequest {
  slot: EquipmentSlot
  slotLabel: string
  /** Objet actuel (mis en évidence). */
  current?: number
  /** Objets déjà équipés ailleurs (signalés). */
  equipped: ReadonlySet<number>
  maxLevel: number
  onPick: (itemId: number) => void
}

export class ItemPicker {
  private readonly dialog: HTMLDialogElement
  private readonly search: HTMLInputElement
  private readonly level: HTMLSelectElement
  private readonly list: HTMLOListElement
  private readonly count: HTMLElement
  private readonly title: HTMLElement
  private req: PickRequest | null = null
  private results: CatalogItem[] = []
  private readonly folded = new Map<number, string>()

  constructor(private readonly items: readonly CatalogItem[]) {
    for (const it of items) this.folded.set(it.id, fold(`${it.name} ${it.setName ?? ''} ${it.typeName ?? ''}`))
    const d = document.createElement('dialog')
    d.className = 'sv-picker'
    d.setAttribute('aria-labelledby', 'sv-picker-title')
    d.innerHTML = `
      <form method="dialog" class="sv-picker-box">
        <header class="sv-picker-head">
          <h2 id="sv-picker-title">Choisir un objet</h2>
          <button class="btn icon" value="cancel" aria-label="Fermer">✕</button>
        </header>
        <div class="sv-picker-filters">
          <label class="sv-field grow"><span>Recherche</span><input type="search" name="q" placeholder="Nom, panoplie ou type…" autocomplete="off" /></label>
          <label class="sv-field"><span>Niveau</span><select name="level">
            <option value="0">Tous</option><option value="200">200</option><option value="190">190 et +</option><option value="170">170 et +</option><option value="150">150 et +</option>
          </select></label>
        </div>
        <p class="sv-picker-count" aria-live="polite"></p>
        <ol class="sv-picker-list"></ol>
      </form>`
    document.body.appendChild(d)
    this.dialog = d
    this.search = d.querySelector('input[name="q"]')!
    this.level = d.querySelector('select[name="level"]')!
    this.list = d.querySelector('.sv-picker-list')!
    this.count = d.querySelector('.sv-picker-count')!
    this.title = d.querySelector('#sv-picker-title')!
    this.search.addEventListener('input', () => this.filter())
    this.level.addEventListener('change', () => this.filter())
    this.search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (this.results[0]) this.pick(this.results[0].id)
      }
    })
    this.list.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')
      if (b) this.pick(Number(b.dataset.item))
    })
    this.list.addEventListener(
      'error',
      e => {
        const img = e.target
        if (img instanceof HTMLImageElement && img.parentElement) {
          img.parentElement.classList.add('no-img')
          img.remove()
        }
      },
      true,
    )
    d.addEventListener('click', e => {
      if (e.target === d) d.close() // clic hors de la boîte
    })
  }

  open(req: PickRequest): void {
    this.req = req
    this.title.textContent = `Choisir — ${req.slotLabel}`
    this.search.value = ''
    this.filter()
    this.dialog.showModal()
    this.search.focus()
  }

  private pick(id: number): void {
    const req = this.req
    this.dialog.close()
    this.req = null
    req?.onPick(id)
  }

  private filter(): void {
    const req = this.req
    if (!req) return
    const words = fold(this.search.value).split(/\s+/).filter(Boolean)
    const minLevel = Number(this.level.value)
    const all = this.items.filter(
      it => it.slot === req.slot && it.level <= req.maxLevel && it.level >= minLevel && words.every(w => this.folded.get(it.id)!.includes(w)),
    )
    this.results = all.slice(0, MAX_RESULTS)
    this.count.textContent = all.length
      ? `${all.length} objet${all.length > 1 ? 's' : ''}${all.length > MAX_RESULTS ? ` — ${MAX_RESULTS} premiers affichés, précisez la recherche` : ''}`
      : 'Aucun objet ne correspond.'
    this.list.innerHTML = this.results
      .map(it => {
        const tags = [it.id === req.current ? 'actuel' : '', req.equipped.has(it.id) && it.id !== req.current ? 'déjà équipé' : ''].filter(Boolean)
        return `<li><button type="button" class="sv-pick${it.id === req.current ? ' current' : ''}" data-item="${it.id}">
          <span class="sv-icon" data-glyph="${esc(req.slotLabel.slice(0, 1))}">${it.iconId !== undefined ? `<img src="${ICON_URL(it.iconId)}" alt="" width="40" height="40" loading="lazy" decoding="async" />` : ''}</span>
          <span class="sv-pick-main">
            <span class="sv-slot">niv. ${it.level}${it.typeName ? ` · ${esc(it.typeName)}` : ''}${tags.length ? ` · <em>${tags.join(', ')}</em>` : ''}</span>
            <b>${esc(it.name)}</b>
            ${it.setName ? `<span class="sv-set">${esc(it.setName)}</span>` : ''}
            <span class="sv-pick-lines">${it.lines.slice(0, 8).map(esc).join(' · ')}</span>
          </span>
        </button></li>`
      })
      .join('')
  }
}
