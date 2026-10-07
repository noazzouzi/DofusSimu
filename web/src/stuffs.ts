/**
 * Section « Stuffs » du visualiseur : stuff complet de chaque personnage — équipe d'un fichier `data/teams/*.json`
 * (module virtuel `virtual:dofussimu-stuffs`, web/plugins/stuffs.ts) ou personnages du combat chargé (fiches
 * `meta.team[].sheet` des replays). Fiches au format src/stats/sheet.ts : rien n'est recalculé ici.
 *
 * Mode édition (serveur de développement, `npm run dev`) : composition (ajouter, retirer, changer une classe), preset
 * (identité IA), rôle, objets par emplacement, forgemagie, points, parchemins, variantes de sorts, import d'un lien
 * RoxxSolver ; chaque modification est recalculée par le moteur (web/src/stuffs-editor.ts) et l'équipe est enregistrée
 * dans data/teams (fichier existant ou nouveau fichier), au format lu par la CLI.
 */
import type { SheetElement, SheetItem, SheetStat, StuffCatalog, StuffSheet, TeamStuffs } from '@/stats/sheet'
import type { PrimaryStat } from '@/stats/characteristicPoints'
import type { Replay } from '@/replay/types'
import { formatInt } from '@/replay/log'
import { esc } from './ui/panels'
import { loadEditorData, slotLayout, TeamEditor, type EditorData } from './stuffs-editor'
import { ItemPicker } from './stuffs-picker'
import './stuffs.css'

/** Images des objets (DofusDB) ; repli sur l'initiale de l'emplacement si elles sont inaccessibles. */
const ICON_URL = (iconId: number) => `https://api.dofusdb.fr/img/items/${iconId}.png`
/** Plafond joueur des % de résistance en combat (src/damage). */
const RES_PCT_CAP = 50
const MAIN_STAT: Readonly<Record<string, { key: string; label: string }>> = {
  earth: { key: 'strength', label: 'Force' },
  fire: { key: 'intelligence', label: 'Intelligence' },
  water: { key: 'chance', label: 'Chance' },
  air: { key: 'agility', label: 'Agilité' },
}
const PRIMARY_FR: readonly [PrimaryStat, string][] = [
  ['vitality', 'Vitalité'], ['wisdom', 'Sagesse'], ['strength', 'Force'], ['intelligence', 'Intelligence'], ['chance', 'Chance'], ['agility', 'Agilité'],
]
const SLOT_FR: Readonly<Record<string, string>> = {
  amulet: 'Amulette', ring: 'Anneau', belt: 'Ceinture', boots: 'Bottes', hat: 'Coiffe', cloak: 'Cape', shield: 'Bouclier', weapon: 'Arme',
  pet: 'Familier / Monture', dofus: 'Dofus / Trophée', other: 'Autre',
}
const FORGE_LABEL: Readonly<Record<string, string>> = { exo: 'Exo', over: 'Over', transcendence: 'Transc.' }
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>'

interface Source {
  key: string
  label: string
  title: string
  subtitle: string
  members: StuffSheet[]
  notes: string[]
  error?: string
  /** Équipe d'un fichier de data/teams (modifiable). */
  team?: TeamStuffs
}

const fmt = (n: number) => formatInt(n)
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))
const attr = (s: string) => esc(s).replace(/"/g, '&quot;')

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  return name.slice(0, 2)
}

function frDate(iso?: string): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '')
}

function statOf(s: StuffSheet, key: string): SheetStat | undefined {
  for (const g of s.groups) for (const st of g.stats) if (st.key === key) return st
  return undefined
}
const statValue = (s: StuffSheet, key: string) => statOf(s, key)?.value ?? 0
const primaryValue = (s: StuffSheet, key: string) => s.primary.find(p => p.stat === key)?.total ?? 0
const elementOf = (s: StuffSheet, el: string): SheetElement | undefined => s.elements.find(e => e.element === el)

function teamSource(t: TeamStuffs): Source {
  const who = t.chosenBy ? `Équipe choisie par l’${t.chosenBy}${t.decidedAt ? ` le ${frDate(t.decidedAt)}` : ''}` : 'Équipe'
  const main = t.fileName === `${t.scenario}.json`
  return {
    key: `team:${t.file}`,
    label: `Équipe — ${t.scenarioName}${main ? '' : ` (${t.fileName})`}`,
    title: t.scenarioName,
    subtitle: `${who} · ${t.members.length} personnage${t.members.length > 1 ? 's' : ''} · ${t.file}`,
    members: t.members,
    notes: [...(t.description ? [t.description] : []), ...t.notes],
    error: t.error,
    team: t,
  }
}

export class StuffsView {
  private sources: Source[] = []
  private catalogError?: string
  private readonly editable: boolean
  private sourceKey = ''
  private replayFighters: (number | undefined)[] = []
  private memberIndex = 0
  private open = new Set<number>()
  private editorData: EditorData | null = null
  private picker: ItemPicker | null = null
  private edit: TeamEditor | null = null
  private flash: { text: string; error?: boolean } | null = null
  private addOpen = false
  private saveAsOpen = false
  private roxxOpen = false

  constructor(
    private readonly root: HTMLElement,
    catalog: StuffCatalog,
  ) {
    this.sources = catalog.teams.map(teamSource)
    this.sourceKey = this.sources[0]?.key ?? ''
    this.catalogError = catalog.error
    this.editable = !!catalog.editable
    root.addEventListener('click', e => void this.onClick(e))
    root.addEventListener('change', e => void this.onChange(e))
    root.addEventListener('keydown', e => this.onKey(e))
    // Image d'objet inaccessible (hors ligne) : initiale de l'emplacement.
    root.addEventListener(
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
    window.addEventListener('beforeunload', e => {
      if (this.edit?.dirty) e.preventDefault()
    })
    this.render()
  }

  /** Fiches du combat chargé (replays récents) ; source retirée si le replay n'en a pas. */
  setReplay(replay: Replay | null): void {
    const team = (replay?.meta?.team ?? []).filter(m => m.sheet)
    const wasReplay = this.sourceKey === 'replay'
    this.sources = this.sources.filter(s => s.key !== 'replay')
    this.replayFighters = team.map(m => m.fighterId)
    if (replay && team.length) {
      const title = replay.meta?.title ?? 'combat sans titre'
      this.sources.push({
        key: 'replay',
        label: `Combat chargé — ${title}`,
        title: 'Combat chargé',
        subtitle: `${title}${replay.meta?.createdAt ? ` · simulé le ${frDate(replay.meta.createdAt)}` : ''}`,
        members: team.map(m => m.sheet!),
        notes: [],
      })
    } else if (wasReplay) {
      this.sourceKey = this.sources[0]?.key ?? ''
      this.memberIndex = 0
    }
    this.render()
  }

  /** Le combat chargé a-t-il des fiches de stuff ? */
  hasReplaySheets(): boolean {
    return this.sources.some(s => s.key === 'replay')
  }

  /** Affiche le stuff d'un personnage du combat chargé (par id de combattant ; défaut : le premier). */
  showReplayFighter(fighterId?: number): void {
    if (!this.hasReplaySheets() || this.edit) return
    this.select('replay', Math.max(0, fighterId === undefined ? 0 : this.replayFighters.indexOf(fighterId)))
  }

  private get source(): Source | undefined {
    return this.sources.find(s => s.key === this.sourceKey) ?? this.sources[0]
  }

  private select(key: string, index: number): void {
    if (key !== this.sourceKey || index !== this.memberIndex) {
      this.open.clear()
      this.roxxOpen = false
    }
    this.sourceKey = key
    this.memberIndex = index
    this.render()
  }

  // ───────────────────────────── édition ─────────────────────────────

  private async startEdit(): Promise<void> {
    const team = this.source?.team
    if (!team || !this.editable) return
    try {
      this.flash = { text: 'Chargement du catalogue d’objets…' }
      this.render()
      this.editorData ??= await loadEditorData(team.scenario)
      this.picker ??= new ItemPicker(this.editorData.items)
      this.flash = null
      this.open.clear()
      this.edit = new TeamEditor(team, this.editorData, () => this.render())
      await this.edit.refresh()
    } catch (e) {
      this.flash = { text: (e as Error).message, error: true }
      this.edit = null
      this.render()
    }
  }

  private stopEdit(): void {
    if (this.edit?.dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return
    this.edit = null
    this.addOpen = this.saveAsOpen = this.roxxOpen = false
    this.open.clear()
    this.render()
  }

  private async save(asNew: boolean): Promise<void> {
    const edit = this.edit
    const src = this.source
    if (!edit || !src?.team) return
    let name = src.team.fileName
    if (asNew) {
      name = (this.root.querySelector<HTMLInputElement>('#sv-saveas')?.value ?? '').trim()
      if (!name) {
        this.flash = { text: 'Donnez un nom au nouveau fichier d’équipe.', error: true }
        this.render()
        return
      }
    }
    try {
      const team = await edit.save(name, !asNew)
      const fresh = teamSource(team)
      const at = this.sources.findIndex(s => s.key === fresh.key)
      if (at >= 0) this.sources[at] = fresh
      else this.sources.splice(this.sources.filter(s => s.team).length, 0, fresh)
      this.edit = null
      this.addOpen = this.saveAsOpen = this.roxxOpen = false
      this.sourceKey = fresh.key
      const cli = team.fileName === `${team.scenario}.json` ? `npm run sim -- … ${team.scenario}` : `npm run sim -- … ${team.scenario} --team-file ${team.file}`
      this.flash = { text: `Enregistré dans ${team.file} — utilisé par ${cli}.` }
    } catch (e) {
      this.flash = { text: `Enregistrement impossible : ${(e as Error).message}`, error: true }
    }
    this.render()
  }

  // ───────────────────────────── événements ─────────────────────────────

  private async onClick(e: Event): Promise<void> {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!t || !this.root.contains(t) || t instanceof HTMLSelectElement || t instanceof HTMLInputElement) return
    const act = t.dataset.act!
    const i = this.memberIndex
    const pos = Number(t.dataset.pos)
    const ed = this.edit
    switch (act) {
      case 'member':
        return this.select(this.sourceKey, Number(t.dataset.index))
      case 'item': {
        const k = Number(t.dataset.index)
        if (this.open.has(k)) this.open.delete(k)
        else this.open.add(k)
        const li = t.closest('.sv-item')
        const body = li?.querySelector<HTMLElement>('.sv-item-body')
        t.setAttribute('aria-expanded', String(this.open.has(k)))
        li?.classList.toggle('open', this.open.has(k))
        if (body) body.hidden = !this.open.has(k)
        return this.syncToggleAll()
      }
      case 'all': {
        const n = this.root.querySelectorAll('[data-act="item"]').length
        const keys = [...this.root.querySelectorAll<HTMLElement>('[data-act="item"]')].map(b => Number(b.dataset.index))
        this.open = new Set(this.open.size < n ? keys : [])
        return this.render()
      }
      case 'e-start':
        return this.startEdit()
      case 'e-cancel':
        return this.stopEdit()
      case 'e-save':
        return this.save(false)
      case 'e-saveas':
        this.saveAsOpen = true
        this.render()
        this.root.querySelector<HTMLInputElement>('#sv-saveas')?.focus()
        return
      case 'e-saveas-ok':
        return this.save(true)
      case 'e-saveas-cancel':
        this.saveAsOpen = false
        return this.render()
      case 'e-add':
        this.addOpen = true
        this.render()
        this.root.querySelector<HTMLSelectElement>('[data-act="e-add-class"]')?.focus()
        return
      case 'e-add-cancel':
        this.addOpen = false
        return this.render()
      case 'e-remove': {
        const k = Number(t.dataset.index)
        const name = ed?.sheets()[k]?.name ?? `personnage ${k + 1}`
        if (!ed || !window.confirm(`Retirer ${name} de l’équipe ?`)) return
        if (this.memberIndex >= k && this.memberIndex > 0) this.memberIndex--
        return ed.removeMember(k)
      }
      case 'e-reset':
        return ed?.resetStuff(i)
      case 'e-roxx-open':
        this.roxxOpen = !this.roxxOpen
        this.render()
        this.root.querySelector<HTMLInputElement>('#sv-roxx-url')?.focus()
        return
      case 'e-roxx': {
        const url = this.root.querySelector<HTMLInputElement>('#sv-roxx-url')?.value ?? ''
        if (!ed || !url.trim()) return
        try {
          await ed.importRoxx(i, url)
          this.roxxOpen = false
        } catch (err) {
          this.flash = { text: `Import RoxxSolver impossible : ${(err as Error).message}`, error: true }
        }
        return this.render()
      }
      case 'e-pick': {
        const b = ed?.build(i)
        if (!ed || !b || !this.picker) return
        const layout = slotLayout(b, ed.data.byId)
        const p = layout[pos]
        if (!p) return
        const current = p.index >= 0 ? b.items[p.index].itemId : undefined
        this.picker.open({
          slot: p.slot,
          slotLabel: SLOT_FR[p.slot] ?? p.slot,
          current,
          equipped: new Set(b.items.map(x => x.itemId)),
          maxLevel: b.level ?? ed.data.meta.level,
          onPick: id => ed.setItem(i, pos, id),
        })
        return
      }
      case 'e-clear':
        return ed?.clearItem(i, pos)
      case 'e-forge-del':
        return ed?.removeForge(i, pos, Number(t.dataset.line))
      case 'e-scrolls':
        return ed?.fullScrolls(i)
      case 'e-alloc': {
        const primary = this.root.querySelector<HTMLSelectElement>('#sv-alloc-primary')?.value as PrimaryStat
        const rest = (this.root.querySelector<HTMLSelectElement>('#sv-alloc-rest')?.value || null) as PrimaryStat | null
        try {
          await ed?.allocate(i, primary, rest)
        } catch (err) {
          this.flash = { text: (err as Error).message, error: true }
          this.render()
        }
        return
      }
      case 'e-spell':
        return ed?.toggleSpell(i, Number(t.dataset.pair))
      case 'flash-close':
        this.flash = null
        return this.render()
    }
  }

  private async onChange(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    if (el.id === 'sv-source') return this.select(el.value, 0)
    const ed = this.edit
    if (!ed) return
    const i = this.memberIndex
    const v = el.value
    switch (el.dataset.act) {
      case 'e-add-class':
        if (!v) return
        this.addOpen = false
        ed.addMember(Number(v))
        this.memberIndex = ed.drafts.length - 1
        return this.render()
      case 'e-name':
        return ed.setName(i, v)
      case 'e-class':
        return ed.setClass(i, Number(v))
      case 'e-preset':
        return ed.setPreset(i, v, !!ed.drafts[i].build)
      case 'e-role':
        return ed.setRole(i, v)
      case 'e-fixed':
        return ed.setFixed(i, (el as HTMLInputElement).checked)
      case 'e-stuff':
        if (v) ed.loadStuff(i, v)
        return
      case 'e-forge-add':
        if (v !== '') ed.addForge(i, Number(el.dataset.pos), Number(v))
        return
      case 'e-pts':
        return ed.setPoints(i, el.dataset.stat as PrimaryStat, Number(v))
      case 'e-scr':
        return ed.setScrolls(i, el.dataset.stat as PrimaryStat, Number(v))
    }
  }

  /** Flèches gauche / droite dans la liste des personnages (onglets) ; Entrée dans les champs d'import. */
  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && t.id === 'sv-roxx-url') {
      e.preventDefault()
      this.root.querySelector<HTMLElement>('[data-act="e-roxx"]')?.click()
      return
    }
    if (e.key === 'Enter' && t.id === 'sv-saveas') {
      e.preventDefault()
      void this.save(true)
      return
    }
    if (t.dataset.act !== 'member' || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    const n = this.edit ? this.edit.drafts.length : (this.source?.members.length ?? 0)
    if (!n) return
    e.preventDefault()
    const next = (this.memberIndex + (e.key === 'ArrowRight' ? 1 : n - 1)) % n
    this.select(this.sourceKey, next)
    this.root.querySelector<HTMLElement>(`[data-act="member"][data-index="${next}"]`)?.focus()
  }

  private syncToggleAll(): void {
    const btn = this.root.querySelector<HTMLElement>('[data-act="all"]')
    const n = this.root.querySelectorAll('[data-act="item"]').length
    if (btn) btn.textContent = this.open.size >= n && n ? 'Tout replier' : 'Tout déplier'
  }

  // ───────────────────────────── rendu ─────────────────────────────

  render(): void {
    const src = this.source
    if (!src) {
      this.root.innerHTML = `<div class="sv-wrap"><header class="sv-head"><div class="sv-titles"><p class="sv-kicker">Stuffs</p><h1 id="sv-title">Aucune équipe</h1>
        <p class="sv-sub">Ajoutez un fichier d’équipe dans <code>data/teams/</code> (voir le README, « Composition de l’utilisateur »).</p></div></header>
        ${this.catalogError ? `<p class="sv-error">Fiches de stuff indisponibles : ${esc(this.catalogError)}</p>` : ''}</div>`
      return
    }
    const ed = this.edit
    const members: (StuffSheet | undefined)[] = ed ? ed.sheets() : src.members
    if (this.memberIndex >= members.length) this.memberIndex = Math.max(0, members.length - 1)
    const m = members[this.memberIndex]
    const options = this.sources.map(s => `<option value="${attr(s.key)}"${s === src ? ' selected' : ''}>${esc(s.label)}</option>`).join('')
    const canEdit = this.editable && !!src.team?.drafts.length
    const shown = members.filter((s): s is StuffSheet => !!s)
    this.root.innerHTML = `
      <div class="sv-wrap${ed ? ' editing' : ''}">
        <header class="sv-head">
          <div class="sv-titles">
            <p class="sv-kicker">${ed ? 'Stuffs — modification' : 'Stuffs'}</p>
            <h1 id="sv-title">${esc(src.title)}</h1>
            <p class="sv-sub">${esc(src.subtitle)}</p>
          </div>
          <div class="sv-head-actions">
            ${!ed && this.sources.length > 1 ? `<label class="select-wrap sv-source"><span class="sr-only">Équipe affichée</span><select id="sv-source">${options}</select></label>` : ''}
            ${!ed && canEdit ? '<button class="btn primary" type="button" data-act="e-start">Modifier l’équipe</button>' : ''}
            ${!ed && !this.editable && src.team ? '<span class="sv-hint">Lecture seule — modification avec <code>npm run dev</code></span>' : ''}
          </div>
        </header>
        ${this.flash ? `<p class="sv-flash${this.flash.error ? ' error' : ''}" role="status">${esc(this.flash.text)} <button class="link-btn" type="button" data-act="flash-close">OK</button></p>` : ''}
        ${src.error ? `<p class="sv-error">${esc(src.error)}</p>` : ''}
        ${ed?.error ? `<p class="sv-error" role="alert">Équipe invalide : ${esc(ed.error)}</p>` : ''}
        ${members.length || ed ? this.roster(members) : ''}
        ${m ? this.sheet(m) : members.length ? '<div class="panel sv-pending sv-pad">Calcul du personnage…</div>' : ''}
        ${shown.length > 1 && shown.length === members.length ? this.compare(shown) : ''}
        ${!ed && src.notes.length ? `<details class="sv-notes panel"><summary>Notes du fichier d’équipe</summary><ul>${src.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}
        ${ed ? this.editBar(ed, src) : ''}
      </div>`
    this.syncToggleAll()
  }

  private className(breedId: number): string {
    return this.editorData?.meta.classes.find(c => c.breedId === breedId)?.name ?? `Classe ${breedId}`
  }

  private roster(members: (StuffSheet | undefined)[]): string {
    const ed = this.edit
    const cards = members.map((s, i) => {
      const sel = i === this.memberIndex
      const main = s?.element ? MAIN_STAT[s.element] : undefined
      const name = s?.name ?? this.className(ed?.drafts[i]?.breedId ?? 0)
      const card = `<button class="sv-card el-${s?.element ?? 'neutral'}${s ? '' : ' pending'}" role="tab" type="button" data-act="member" data-index="${i}"
            aria-selected="${sel}" tabindex="${sel ? 0 : -1}" aria-controls="sv-sheet">
          <span class="sv-avatar">${esc(initials(name))}</span>
          <span class="sv-card-text">
            <b>${esc(name)}</b>
            ${
              s
                ? `<span class="sv-card-sub">${esc([s.className, s.roleLabel, s.elementLabel].filter(Boolean).join(' · '))}</span>
            <span class="sv-card-stats">
              <span>${fmt(s.hp)} PV</span><span>${statValue(s, 'ap')} PA</span><span>${statValue(s, 'mp')} PM</span><span>${statValue(s, 'range')} PO</span>
              ${main ? `<span>${fmt(primaryValue(s, main.key))} ${esc(main.label)}</span>` : ''}
            </span>`
                : '<span class="sv-card-sub">Calcul…</span>'
            }
          </span>
        </button>`
      const remove = ed && members.length > 1 ? `<button class="sv-card-x" type="button" data-act="e-remove" data-index="${i}" aria-label="Retirer ${attr(name)}" title="Retirer de l’équipe">✕</button>` : ''
      return `<div class="sv-card-wrap">${card}${remove}</div>`
    })
    if (ed && members.length < 8) {
      cards.push(
        this.addOpen
          ? `<div class="sv-card add open"><label class="sv-field"><span>Classe du nouveau personnage</span><select data-act="e-add-class"><option value="">Choisir…</option>${ed.data.meta.classes
              .map(c => `<option value="${c.breedId}">${esc(c.name)}</option>`)
              .join('')}</select></label><button class="link-btn" type="button" data-act="e-add-cancel">Annuler</button></div>`
          : '<button class="sv-card add" type="button" data-act="e-add"><span class="sv-plus" aria-hidden="true">+</span>Ajouter un personnage</button>',
      )
    }
    return `<div class="sv-roster" role="tablist" aria-label="Personnages">${cards.join('')}</div>`
  }

  private sheet(s: StuffSheet): string {
    const ed = this.edit
    const meta = [
      s.presetLabel ? `<dt>Preset</dt><dd>${esc(s.presetLabel)} <code>${esc(s.presetId ?? '')}</code></dd>` : '',
      s.buildId ? `<dt>Build</dt><dd><code>${esc(s.buildId)}</code></dd>` : '',
      `<dt>Stuff</dt><dd${s.stuffSource ? ` title="${attr(s.stuffSource)}"` : ''}>${esc(s.stuffLabel ?? 'Stuff personnalisé')}</dd>`,
      s.origin ? `<dt>Origine</dt><dd>${esc(s.origin)}</dd>` : '',
    ].join('')
    const tags = [
      `<span class="tag">Niv. ${s.level}</span>`,
      s.roleLabel ? `<span class="tag">${esc(s.roleLabel)}</span>` : '',
      s.elementLabel ? `<span class="tag el el-${s.element}">${esc(s.elementLabel)}</span>` : '',
      s.valid ? '' : '<span class="tag dead">Build invalide</span>',
    ].join('')
    const notices = ed?.notices.get(this.memberIndex) ?? []
    return `
      <article class="sv-sheet" id="sv-sheet" role="tabpanel" aria-label="Stuff de ${attr(s.name)}">
        <header class="sv-sheet-head panel el-${s.element ?? 'neutral'}">
          <span class="sv-avatar big">${esc(initials(s.name))}</span>
          <div class="sv-sheet-title">
            <h2>${esc(s.name)} <small>${esc(s.className)}</small></h2>
            <div class="sv-tags">${tags}</div>
          </div>
          ${ed ? this.memberForm(s) : `<dl class="sv-meta">${meta}</dl>`}
        </header>
        ${notices.length ? `<div class="sv-issues warn" role="note"><b>Import RoxxSolver</b><ul>${notices.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        ${s.issues.length ? this.issues(s) : ''}
        <div class="sv-grid">
          <div class="sv-col">
            ${ed ? this.editItems(s) : this.items(s)}
            ${this.sets(s)}
          </div>
          <div class="sv-col">
            ${this.stats(s)}
            ${this.spells(s)}
          </div>
        </div>
      </article>`
  }

  /** Champs du personnage en mode édition : nom, classe, preset, rôle, stuff enregistré, import RoxxSolver. */
  private memberForm(s: StuffSheet): string {
    const ed = this.edit!
    const i = this.memberIndex
    const d = ed.drafts[i]
    const meta = ed.data.meta
    const presets = meta.presets.filter(p => p.breedId === d.breedId)
    const preset = presets.find(p => p.id === (d.preset ?? s.presetId))
    const stuffs = meta.stuffs.filter(x => !x.breeds || x.breeds.includes(d.breedId))
    const opt = (value: string, label: string, sel: boolean) => `<option value="${attr(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`
    const custom = !!d.build
    return `<div class="sv-form">
        <label class="sv-field"><span>Nom</span><input type="text" data-act="e-name" value="${attr(d.name ?? '')}" placeholder="${attr(s.name)}" maxlength="40" /></label>
        <label class="sv-field"><span>Classe</span><select data-act="e-class">${meta.classes.map(c => opt(String(c.breedId), c.name, c.breedId === d.breedId)).join('')}</select></label>
        <label class="sv-field wide"><span>Preset — identité de l’IA (rôle, rotation, sorts)</span><select data-act="e-preset">${presets
          .map(p => opt(p.id, `${p.scenario ? '★ ' : ''}${p.label}`, p.id === preset?.id))
          .join('')}</select></label>
        <label class="sv-field"><span>Rôle</span><select data-act="e-role">${opt('', `Celui du preset${preset ? ` (${meta.roles.find(r => r.id === preset.role)?.label ?? preset.role})` : ''}`, !d.role)}${meta.roles
          .map(r => opt(r.id, r.label, r.id === d.role))
          .join('')}</select></label>
        <label class="sv-field wide"><span>Charger un stuff enregistré</span><select data-act="e-stuff">${opt('', d.stuff ? `Actuel : ${stuffs.find(x => x.id === d.stuff)?.label ?? d.stuff}` : 'Choisir…', true)}${stuffs
          .map(x => opt(x.id, x.label, false))
          .join('')}</select></label>
        <label class="sv-check"><input type="checkbox" data-act="e-fixed"${d.fixed ? ' checked' : ''} /> Build imposé (optimize ne le change pas)</label>
      </div>
      <div class="sv-form-actions">
        <span class="sv-chip${custom ? ' custom' : ''}">${custom ? 'Stuff personnalisé' : d.stuff ? 'Stuff enregistré' : 'Stuff du preset'}</span>
        ${custom || d.stuff ? '<button class="link-btn" type="button" data-act="e-reset">Revenir au stuff du preset</button>' : ''}
        <button class="link-btn" type="button" data-act="e-roxx-open" aria-expanded="${this.roxxOpen}">Importer un lien RoxxSolver</button>
      </div>
      ${
        this.roxxOpen
          ? `<div class="sv-roxx">
              <label class="sv-field grow"><span>Lien de partage RoxxSolver (« build »)</span><input id="sv-roxx-url" type="url" placeholder="https://roxxsolver.com/solver?build=…" autocomplete="off" /></label>
              <button class="btn primary" type="button" data-act="e-roxx">Importer</button>
              <p class="sv-note">Remplace le stuff, les points et les parchemins de ${esc(s.name)} (et sa classe si le lien en a une autre). Les sorts et l’IA restent ceux du preset.</p>
            </div>`
          : ''
      }`
  }

  private issues(s: StuffSheet): string {
    return `<div class="sv-issues ${s.valid ? 'warn' : 'error'}" role="note"><b>${s.valid ? 'À vérifier' : 'Build impossible en jeu'}</b><ul>${s.issues
      .map(i => `<li>${esc(i.message)}</li>`)
      .join('')}</ul></div>`
  }

  private itemHead(it: SheetItem, key: number): string {
    const isOpen = this.open.has(key)
    const fm = it.forgemagie.map(f => `<span class="fm ${f.kind}">${FORGE_LABEL[f.kind] ?? f.kind} ${esc(f.label)}</span>`).join('')
    return `<button class="sv-item-head" type="button" data-act="item" data-index="${key}" aria-expanded="${isOpen}" aria-controls="sv-item-${key}">
          <span class="sv-icon" data-glyph="${esc(it.slotLabel.slice(0, 1))}">${it.iconId !== undefined ? `<img src="${ICON_URL(it.iconId)}" alt="" width="44" height="44" loading="lazy" decoding="async" />` : ''}</span>
          <span class="sv-item-main">
            <span class="sv-slot">${esc(it.slotLabel)} · niv. ${it.level}${it.typeName && it.slot !== 'dofus' && it.slot !== 'pet' ? ` · ${esc(it.typeName)}` : ''}</span>
            <b>${esc(it.name)}</b>
            ${it.setName ? `<span class="sv-set">${esc(it.setName)}</span>` : ''}
            ${fm && !this.edit ? `<span class="sv-fm">${fm}</span>` : ''}
          </span>
          <span class="sv-chevron">${CHEVRON}</span>
        </button>`
  }

  private items(s: StuffSheet): string {
    const row = (it: SheetItem, i: number) => {
      const isOpen = this.open.has(i)
      return `<li class="sv-item${isOpen ? ' open' : ''}${it.issues.length ? ' has-issue' : ''}">
        ${this.itemHead(it, i)}
        <div class="sv-item-body" id="sv-item-${i}"${isOpen ? '' : ' hidden'}>${this.itemBody(it)}</div>
      </li>`
    }
    const indexed = s.items.map((it, i) => ({ it, i }))
    const gear = indexed.filter(x => x.it.slot !== 'dofus')
    const dofus = indexed.filter(x => x.it.slot === 'dofus')
    const forgeCount = s.items.reduce((n, it) => n + it.forgemagie.length, 0)
    return `<section class="panel sv-items" aria-label="Équipement">
      <header class="panel-head"><h2>Équipement</h2>
        <span class="hint">${s.items.length} objet${s.items.length > 1 ? 's' : ''}${forgeCount ? ` · ${forgeCount} ligne${forgeCount > 1 ? 's' : ''} de forgemagie` : ''}</span>
        ${s.items.length ? '<button class="link-btn" type="button" data-act="all">Tout déplier</button>' : ''}
      </header>
      ${s.items.length ? '' : '<p class="empty sv-pad">Aucun équipement.</p>'}
      ${gear.length ? `<ul class="sv-list">${gear.map(x => row(x.it, x.i)).join('')}</ul>` : ''}
      ${dofus.length ? `<h3 class="sv-subhead">Dofus et trophées</h3><ul class="sv-list">${dofus.map(x => row(x.it, x.i)).join('')}</ul>` : ''}
    </section>`
  }

  /** Équipement en mode édition : les 16 emplacements (vides compris), choix d'objet, forgemagie. */
  private editItems(s: StuffSheet): string {
    const ed = this.edit!
    const i = this.memberIndex
    const b = ed.build(i)
    if (!b) return '<section class="panel sv-items sv-pad">Calcul du stuff…</section>'
    const layout = slotLayout(b, ed.data.byId)
    // Fiche de chaque objet du build (même ordre d'apparition par id).
    const pool = new Map<number, SheetItem[]>()
    for (const it of s.items) pool.set(it.itemId, [...(pool.get(it.itemId) ?? []), it])
    const forge = ed.members[i]?.forge ?? {}
    const row = (pos: number) => {
      const p = layout[pos]
      const eq = p.index >= 0 ? b.items[p.index] : undefined
      const it = eq ? pool.get(eq.itemId)?.shift() : undefined
      const label = SLOT_FR[p.slot] ?? p.slot
      if (!eq) {
        return `<li class="sv-item empty-slot"><div class="sv-item-row">
          <button class="sv-item-head" type="button" data-act="e-pick" data-pos="${pos}"><span class="sv-icon" data-glyph="+"></span>
            <span class="sv-item-main"><span class="sv-slot">${esc(label)}</span><b class="sv-empty">Emplacement vide — choisir un objet</b></span></button>
        </div></li>`
      }
      const name = it?.name ?? ed.data.byId.get(eq.itemId)?.name ?? `Objet ${eq.itemId}`
      const lines = eq.exos ?? []
      const present = new Set(lines.map(x => `${x.stat}:${x.value}:${x.kind === 'transcendence' ? 't' : ''}`))
      const choices = (forge[eq.itemId] ?? [])
        .map((c, k) => ({ c, k }))
        .filter(({ c }) => !present.has(`${c.stat}:${c.value}:${c.kind === 'transcendence' ? 't' : ''}`))
      const chips = lines
        .map((x, k) => {
          const f = it?.forgemagie[k]
          return `<span class="fm ${f?.kind ?? x.kind ?? 'exo'}">${FORGE_LABEL[f?.kind ?? 'exo']} ${esc(f?.label ?? `${x.stat} +${x.value}`)}<button type="button" class="fm-x" data-act="e-forge-del" data-pos="${pos}" data-line="${k}" aria-label="Retirer cette ligne">✕</button></span>`
        })
        .join('')
      const key = 100 + pos
      const isOpen = this.open.has(key)
      return `<li class="sv-item${isOpen ? ' open' : ''}${it?.issues.length ? ' has-issue' : ''}">
        <div class="sv-item-row">
          ${it ? this.itemHead(it, key) : `<div class="sv-item-head"><span class="sv-item-main"><span class="sv-slot">${esc(label)}</span><b>${esc(name)}</b></span></div>`}
          <div class="sv-item-actions">
            <button class="btn small" type="button" data-act="e-pick" data-pos="${pos}">Changer</button>
            <button class="btn small icon" type="button" data-act="e-clear" data-pos="${pos}" aria-label="Retirer ${attr(name)}" title="Retirer">✕</button>
          </div>
        </div>
        ${
          chips || choices.length
            ? `<div class="sv-forge-edit">${chips}${
                choices.length
                  ? `<select class="sv-forge-add" data-act="e-forge-add" data-pos="${pos}" aria-label="Ajouter une ligne de forgemagie à ${attr(name)}"><option value="">+ Forgemagie…</option>${choices
                      .map(({ c, k }) => `<option value="${k}">${esc(c.label)}</option>`)
                      .join('')}</select>`
                  : ''
              }</div>`
            : ''
        }
        ${it ? `<div class="sv-item-body" id="sv-item-${key}"${isOpen ? '' : ' hidden'}>${this.itemBody(it)}</div>` : ''}
      </li>`
    }
    const positions = layout.map((_, pos) => pos)
    const gear = positions.filter(pos => layout[pos].slot !== 'dofus' && pos < 10)
    const dofus = positions.filter(pos => layout[pos].slot === 'dofus')
    const extra = positions.filter(pos => pos >= 16 && layout[pos].slot !== 'dofus')
    return `<section class="panel sv-items" aria-label="Équipement">
      <header class="panel-head"><h2>Équipement</h2>
        <span class="hint">${b.items.length} objet${b.items.length > 1 ? 's' : ''} sur 16</span>
        ${b.items.length ? '<button class="link-btn" type="button" data-act="all">Tout déplier</button>' : ''}
      </header>
      <ul class="sv-list">${gear.map(row).join('')}</ul>
      <h3 class="sv-subhead">Dofus, trophées et prysmaradite</h3>
      <ul class="sv-list">${dofus.map(row).join('')}</ul>
      ${extra.length ? `<h3 class="sv-subhead">En surnombre</h3><ul class="sv-list">${extra.map(row).join('')}</ul>` : ''}
    </section>`
  }

  private itemBody(it: SheetItem): string {
    const w = it.weapon
    const weapon = w
      ? `<p class="sv-weapon"><span>${w.apCost} PA</span><span>Portée ${w.minRange === w.range ? w.range : `${w.minRange} à ${w.range}`}</span>` +
        `<span>Critique ${w.critChance} %${w.critBonus ? ` (+${w.critBonus})` : ''}</span><span>${w.maxCastPerTurn} utilisation${w.maxCastPerTurn > 1 ? 's' : ''} par tour</span></p>`
      : ''
    const effects = it.effects
      .map(
        l =>
          `<li class="k-${l.kind}${l.malus ? ' malus' : ''}"><span>${esc(l.text)}</span>${l.range ? `<small title="Plage du jeu">${esc(l.range)}</small>` : ''}</li>`,
      )
      .join('')
    const forge = it.forgemagie.length
      ? `<h4>Forgemagie</h4><ul class="sv-effects fm-list">${it.forgemagie
          .map(f => `<li class="fm-line ${f.kind}"><span>${esc(f.label)}</span><small>${f.kind === 'transcendence' ? 'transcendance' : f.kind}</small></li>`)
          .join('')}</ul>`
      : ''
    return `${weapon}
      ${effects ? `<ul class="sv-effects">${effects}</ul>` : '<p class="empty">Aucun effet.</p>'}
      ${forge}
      ${it.petLevel !== undefined && it.petLevel !== 100 ? `<p class="sv-note">Familier niveau ${it.petLevel} : bonus au prorata.</p>` : ''}
      ${it.conditions ? `<p class="sv-note">Conditions : <code>${esc(it.conditions)}</code></p>` : ''}
      ${it.issues.map(m => `<p class="sv-note bad">${esc(m)}</p>`).join('')}`
  }

  private sets(s: StuffSheet): string {
    if (!s.sets.length) return ''
    const active = s.sets.filter(x => x.tier).length
    return `<section class="panel sv-sets" aria-label="Panoplies">
      <header class="panel-head"><h2>Panoplies</h2><span class="hint">${active} bonus actif${active > 1 ? 's' : ''}</span></header>
      <ul class="sv-set-list">${s.sets
        .map(
          set => `<li class="${set.tier ? 'active' : 'inactive'}">
            <div class="sv-set-head"><b>${esc(set.name)}</b><span class="sv-count">${set.count} / ${set.size}</span></div>
            <p class="sv-set-items">${set.equipped.map(esc).join(' · ')}</p>
            ${
              set.bonus.length
                ? `<ul class="sv-effects compact">${set.bonus.map(l => `<li class="k-${l.kind}${l.malus ? ' malus' : ''}"><span>${esc(l.text)}</span></li>`).join('')}</ul>`
                : '<p class="empty">Aucun bonus (un seul objet).</p>'
            }
          </li>`,
        )
        .join('')}</ul>
    </section>`
  }

  private stats(s: StuffSheet): string {
    const ed = this.edit
    const b = ed?.build(this.memberIndex)
    const main = s.groups.find(g => g.id === 'main')?.stats ?? []
    const kpi = main
      .map(st => {
        const cls = st.key === 'ap' ? ' ap' : st.key === 'mp' ? ' mp' : st.key === 'hp' ? ' hp' : ''
        const label = st.key === 'hp' ? 'PV' : st.label
        return `<div class="stat${cls}"${st.wasted ? ` title="${st.wasted} au-delà du plafond (perdu)"` : ''}><small>${esc(label)}</small><b>${fmt(st.value)}${st.pct ? ' %' : ''}</b>${
          st.wasted ? `<small class="lost">+${st.wasted} perdu</small>` : ''
        }</div>`
      })
      .join('')
    const pts = s.points
    const num = (act: string, stat: string, value: number, max: number, label: string) =>
      `<input class="sv-num" type="number" inputmode="numeric" min="0" max="${max}" step="1" data-act="${act}" data-stat="${stat}" value="${value}" aria-label="${attr(label)}" />`
    const primary = `<div class="sv-table-wrap"><table class="sv-table${b ? ' editing' : ''}">
      <thead><tr><th scope="col">Caractéristique</th><th scope="col" title="Points de caractéristiques investis">Points</th><th scope="col">Base</th><th scope="col" title="Parchemins">Parch.</th><th scope="col" title="Objets, panoplies et forgemagie">Équip.</th><th scope="col">Total</th></tr></thead>
      <tbody>${s.primary
        .map(p => {
          const invested = b ? num('e-pts', p.stat, b.characteristicPoints?.[p.stat] ?? 0, 995, `Points investis en ${p.label}`) : p.invested ? fmt(p.invested) : '—'
          const scrolls = b ? num('e-scr', p.stat, b.scrolls?.[p.stat] ?? 0, 100, `Parchemins de ${p.label}`) : fmt(p.scrolls)
          return `<tr${s.element && MAIN_STAT[s.element]?.key === p.stat ? ' class="main"' : ''}><th scope="row">${esc(p.label)}</th><td>${invested}</td><td>${fmt(p.base)}</td>
          <td>${scrolls}</td><td>${signed(p.equipment)}</td><td><b>${fmt(p.total)}</b></td></tr>`
        })
        .join('')}</tbody></table></div>
      <p class="sv-note${pts.remaining < 0 ? ' bad' : ''}">Points : ${fmt(pts.spent)} dépensés sur ${fmt(pts.available)}${pts.remaining ? ` · <b>${fmt(pts.remaining)} ${pts.remaining > 0 ? 'non dépensés' : 'de trop'}</b>` : ''}.</p>
      ${
        b
          ? `<div class="sv-alloc">
              <label class="sv-field"><span>Répartir : tout en</span><select id="sv-alloc-primary">${PRIMARY_FR.map(
                ([k, l]) => `<option value="${k}"${s.element && MAIN_STAT[s.element]?.key === k ? ' selected' : ''}>${l}</option>`,
              ).join('')}</select></label>
              <label class="sv-field"><span>puis le reste en</span><select id="sv-alloc-rest"><option value="vitality">Vitalité</option><option value="wisdom">Sagesse</option><option value="">rien</option></select></label>
              <button class="btn small" type="button" data-act="e-alloc">Appliquer</button>
              <button class="btn small" type="button" data-act="e-scrolls">Parchemins à 100</button>
            </div>`
          : ''
      }`
    const capped = s.elements.some(e => e.resPct > RES_PCT_CAP)
    const elements = `<div class="sv-table-wrap"><table class="sv-table el-table">
      <thead><tr><th scope="col">Élément</th><th scope="col">Dommages</th><th scope="col">Rés. %</th><th scope="col">Rés. fixe</th></tr></thead>
      <tbody>${s.elements
        .map(
          e => `<tr class="el-${e.element}${s.element === e.element ? ' main' : ''}"><th scope="row"><i class="el-dot"></i>${esc(e.label)}</th><td>${signed(e.damage)}</td>
          <td class="${e.resPct > RES_PCT_CAP ? 'over' : e.resPct < 0 ? 'neg' : ''}">${fmt(e.resPct)} %</td><td>${fmt(e.res)}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      ${capped ? `<p class="sv-note">Au-delà de ${RES_PCT_CAP} %, la résistance est plafonnée en combat (le surplus protège contre les réductions de résistance).</p>` : ''}`
    const group = (id: string) => {
      const g = s.groups.find(x => x.id === id)
      if (!g?.stats.length) return ''
      return `<div class="d-section"><h4>${esc(g.label)}</h4><dl class="kv">${g.stats
        .map(st => `<dt>${esc(st.label)}</dt><dd>${fmt(st.value)}${st.pct ? ' %' : ''}</dd>`)
        .join('')}</dl></div>`
    }
    return `<section class="panel sv-stats" aria-label="Caractéristiques">
      <header class="panel-head"><h2>Caractéristiques</h2><span class="hint">${ed?.busy ? 'calcul…' : 'jets max, comme en simulation'}</span></header>
      <div class="sv-pad sv-stack">
        <div class="sv-kpis">${kpi}</div>
        <div class="d-section"><h4>Caractéristiques primaires</h4>${primary}</div>
        <div class="d-section"><h4>Dommages et résistances par élément</h4>${elements}</div>
        <div class="sv-groups">${group('damage')}${group('secondary')}${group('resistance')}</div>
        ${s.passiveSpells.length ? `<div class="d-section"><h4>Sorts conférés par l’équipement</h4><div class="pills">${s.passiveSpells.map(n => `<span class="pill">${esc(n)}</span>`).join('')}</div></div>` : ''}
      </div>
    </section>`
  }

  private spells(s: StuffSheet): string {
    if (!s.spells.length) return ''
    const editing = !!this.edit
    const variants = s.spells.filter(p => p.variant).length
    const changed = s.spells.filter(p => p.changed).length
    return `<section class="panel sv-spells" aria-label="Sorts">
      <header class="panel-head"><h2>Sorts</h2><span class="hint">${variants} variante${variants > 1 ? 's' : ''} sur ${s.spells.length}${changed ? ` · ${changed} changée${changed > 1 ? 's' : ''} par rapport au preset` : ''}${editing ? ' · cliquer pour changer' : ''}</span></header>
      <ol class="sv-spell-list">${s.spells
        .map(p => {
          const body = `<span class="n">${p.pair + 1}</span><b>${esc(p.active)}</b><small>${p.variant ? 'variante' : 'sort de base'} · au lieu de ${esc(p.other)}</small>`
          return `<li class="${p.variant ? 'variant' : ''}${p.changed ? ' changed' : ''}">${
            editing ? `<button type="button" class="sv-spell-btn" data-act="e-spell" data-pair="${p.pair}" title="Prendre ${attr(p.other)}">${body}</button>` : body
          }</li>`
        })
        .join('')}</ol>
    </section>`
  }

  private compare(members: StuffSheet[]): string {
    const resAvg = (s: StuffSheet) => Math.round(s.elements.reduce((n, e) => n + Math.min(e.resPct, RES_PCT_CAP), 0) / Math.max(1, s.elements.length))
    const rows: { label: string; title?: string; value: (s: StuffSheet) => string }[] = [
      { label: 'Points de vie', value: s => fmt(s.hp) },
      { label: 'PA / PM / PO', value: s => `${statValue(s, 'ap')} / ${statValue(s, 'mp')} / ${statValue(s, 'range')}` },
      { label: 'Carac. principale', value: s => (s.element && MAIN_STAT[s.element] ? `${fmt(primaryValue(s, MAIN_STAT[s.element].key))} ${MAIN_STAT[s.element].label.slice(0, 3)}.` : '—') },
      { label: 'Puissance', value: s => fmt(statValue(s, 'power')) },
      { label: 'Dommages élément', value: s => (s.element ? fmt(elementOf(s, s.element)?.damage ?? 0) : '—') },
      { label: 'Critique', value: s => `${statValue(s, 'critical')} %` },
      { label: 'Soins', value: s => fmt(statValue(s, 'heals')) },
      { label: 'Rés. % moyenne', title: 'Moyenne des 5 éléments, plafonnés à 50 %', value: s => `${resAvg(s)} %` },
      { label: 'Tacle / Fuite', value: s => `${statValue(s, 'tackleBlock')} / ${statValue(s, 'tackleEvade')}` },
      { label: 'Retrait PA / PM', value: s => `${statValue(s, 'apReduction')} / ${statValue(s, 'mpReduction')}` },
      { label: 'Esquive PA / PM', value: s => `${statValue(s, 'apParry')} / ${statValue(s, 'mpParry')}` },
      { label: 'Initiative', value: s => fmt(statValue(s, 'initiative')) },
      { label: 'Invocations', value: s => String(statValue(s, 'summons')) },
    ]
    return `<details class="panel sv-compare" open>
      <summary>Comparer l’équipe</summary>
      <div class="sv-table-wrap"><table class="sv-table compare">
        <thead><tr><th scope="col"><span class="sr-only">Caractéristique</span></th>${members
          .map((s, i) => `<th scope="col" class="${i === this.memberIndex ? 'cur' : ''}"><span class="el-dot el-${s.element ?? 'neutral'}"></span>${esc(s.name)}</th>`)
          .join('')}</tr></thead>
        <tbody>${rows
          .map(
            r => `<tr><th scope="row"${r.title ? ` title="${attr(r.title)}"` : ''}>${esc(r.label)}</th>${members
              .map((s, i) => `<td class="${i === this.memberIndex ? 'cur' : ''}">${r.value(s)}</td>`)
              .join('')}</tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </details>`
  }

  /** Barre d'édition (bas de page) : état, enregistrer, enregistrer sous, annuler. */
  private editBar(ed: TeamEditor, src: Source): string {
    const status = ed.busy ? 'Calcul…' : ed.error ? 'Équipe invalide' : ed.dirty ? 'Modifications non enregistrées' : 'Aucune modification'
    const canSave = ed.dirty && !ed.error && !ed.busy
    const body = this.saveAsOpen
      ? `<label class="sv-field grow"><span>Nouveau fichier dans data/teams/</span><input id="sv-saveas" type="text" placeholder="ex. vortex-iop" maxlength="60" /></label>
         <button class="btn primary" type="button" data-act="e-saveas-ok"${ed.error ? ' disabled' : ''}>Créer</button>
         <button class="btn" type="button" data-act="e-saveas-cancel">Annuler</button>`
      : `<button class="btn" type="button" data-act="e-cancel">Annuler</button>
         <button class="btn" type="button" data-act="e-saveas"${ed.error ? ' disabled' : ''}>Enregistrer sous…</button>
         <button class="btn primary" type="button" data-act="e-save"${canSave ? '' : ' disabled'} title="Écrit ${attr(src.team?.file ?? '')}">Enregistrer</button>`
    return `<div class="sv-editbar" role="region" aria-label="Modification de l’équipe">
      <span class="sv-editbar-status${ed.dirty ? ' dirty' : ''}${ed.error ? ' bad' : ''}" aria-live="polite">${status}</span>
      <div class="sv-editbar-actions">${body}</div>
    </div>`
  }
}
