/**
 * Section « Boss » du visualiseur (`#boss/<monsterId>[/<onglet>]`) : theorycraft DÉTERMINISTE contre un boss, pour un
 * joueur seul (docs/design/theorycraft.md §3). Serveur de développement seulement (`npm run dev`) : les calculs sont
 * faits par l'API de web/plugins/theory.ts (web/src/boss-api.ts).
 *
 *  - recherche de boss avec suggestions (nom du boss ou du donjon, sans accents ni casse : `searchBosses`, le même que
 *    la CLI), Expéditions incluses sur demande, liste complète tant qu'aucun boss n'est choisi ;
 *  - réglage du nombre de joueurs (1 à 8, grade déduit) ou du grade ;
 *  - onglets « Fiche » (web/src/boss-sheet.ts), « Classes » (web/src/boss-classes.ts : stuffs des presets, ou
 *    optimisés contre le boss à la demande) et « Stuff » (web/src/boss-stuff.ts : meilleur stuff d'un preset ou d'un
 *    lien RoxxSolver).
 *
 * Anti-course (comme `TeamEditor.seq`) : un numéro de séquence global ; chaque calcul retient le sien par clé (boss,
 * réglage et mode) et une réponse arrivée après une nouvelle demande pour la même clé est ignorée. Les résultats sont
 * gardés par clé : revenir à un onglet ne relance rien, et une réponse pour un autre boss ou réglage attend en cache.
 * Le serveur calcule en synchrone : pendant un calcul, le bouton qui le relancerait est désactivé, et le mode « stuffs
 * optimisés » (long) ne se relance jamais tout seul sur un autre boss ou réglage.
 */
import { bossGradeFor, searchBosses } from '@/theorycraft/bosses'
import { theoryApi, type BossEntry, type BossProfileDetail, type ClassRanking, type Scale, type StuffVsBossResult, type TheoryPreset } from './boss-api'
import { defaultClassesSort, renderClasses, type ClassesUi } from './boss-classes'
import { renderSheet } from './boss-sheet'
import { renderStuffForm, renderStuffResult, SEARCH_EFFORTS, type StuffForm } from './boss-stuff'
import { errorBox, esc, fmtNum, nextSort, sortableTable, spinner, type Column, type SortState } from './boss-ui'
import './boss.css'

export type BossTab = 'fiche' | 'classes' | 'stuff'
const TABS: readonly { id: BossTab; label: string }[] = [
  { id: 'fiche', label: 'Fiche' },
  { id: 'classes', label: 'Classes' },
  { id: 'stuff', label: 'Stuff' },
]
/** Suggestions affichées sous le champ de recherche. */
const MAX_SUGGESTIONS = 10

/** Durée écoulée depuis `started` (chronomètre des calculs). */
const elapsedText = (started: number) => `${Math.max(0, Math.round((Date.now() - started) / 1000))} s`

/** Adresse d'un boss et d'un onglet. */
export const bossHash = (id: number, tab: BossTab = 'fiche') => `#boss/${id}${tab === 'fiche' ? '' : `/${tab}`}`

/** Calcul en cours ou terminé pour une clé (boss, réglage, mode), avec le numéro de séquence de sa demande. */
interface Pending<T> {
  seq: number
  value?: T
  error?: string
  loading: boolean
  /** Début du calcul (chronomètre). */
  started: number
}

export class BossView {
  private readonly main: HTMLElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLElement
  private entries = new Map<boolean, BossEntry[]>()
  /** Index en cours de chargement (un seul appel à la fois par index). */
  private entriesLoading = new Map<boolean, Promise<void>>()
  private entriesError?: string
  private presets: TheoryPreset[] = []
  private includeExp = false
  private query = ''
  private suggestions: BossEntry[] = []
  private active = -1
  private started = false

  private id: number | null = null
  private tab: BossTab = 'fiche'
  private players = 4
  private grade: number | null = null

  /** Numéro de la dernière demande (tous types) ; chaque calcul garde le sien (`Pending.seq`). */
  private seq = 0
  private profiles = new Map<string, Pending<BossProfileDetail>>()
  private classes = new Map<string, Pending<ClassRanking>>()
  private classesMode: 'preset' | 'optimized' = 'preset'
  /** Tri des tableaux (par identifiant de tableau), partagé par la liste des boss, les classes et le stuff. */
  private sorts = new Map<string, SortState>()
  private classesUi: ClassesUi = { axis: 'damage', sorts: this.sorts, open: new Set() }
  private stuffs = new Map<string, Pending<StuffVsBossResult>>()
  private stuffForm: StuffForm = { preset: '', roxx: '', elements: 'preset', profile: 'balanced', top: 5, iterations: SEARCH_EFFORTS[1].iterations }
  private timer = 0

  constructor(
    private readonly root: HTMLElement,
    /** Titre du document quand la section change de boss (appliqué par main.ts si la section est affichée). */
    private readonly onTitle: (title: string) => void,
  ) {
    root.innerHTML = `<div class="bv-wrap">
      <header class="bv-top">
        <div class="bv-titles">
          <p class="bv-kicker" id="bv-kicker">Theorycraft · un joueur contre un boss</p>
          <h1 id="bv-title">Boss</h1>
        </div>
        <form class="bv-search" role="search" autocomplete="off">
          <div class="bv-combo">
            <svg class="bv-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input id="bv-q" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bv-suggest"
              aria-label="Chercher un boss (nom du boss ou du donjon)" placeholder="Boss ou donjon…" spellcheck="false" />
            <ul id="bv-suggest" class="bv-suggest" role="listbox" aria-label="Boss correspondants" hidden></ul>
          </div>
          <label class="bv-check"><input type="checkbox" id="bv-exp" /><span>Expéditions</span></label>
        </form>
      </header>
      <div id="bv-main" class="bv-main"></div>
    </div>`
    this.main = root.querySelector('#bv-main')!
    this.input = root.querySelector('#bv-q')!
    this.list = root.querySelector('#bv-suggest')!
    root.addEventListener('click', e => this.onClick(e))
    root.addEventListener('input', e => this.onInput(e))
    root.addEventListener('change', e => this.onChange(e))
    root.addEventListener('keydown', e => this.onKey(e))
    root.addEventListener('submit', e => this.onSubmit(e))
    // Retour dans le champ de recherche : suggestions de la recherche en cours.
    this.input.addEventListener('focus', () => {
      if (this.query.trim()) this.updateSuggestions()
    })
    // Détails dépliés (composition) : gardés entre deux rendus (`toggle` ne remonte pas : capture).
    root.addEventListener(
      'toggle',
      e => {
        const d = e.target as HTMLDetailsElement
        const key = d.dataset?.key
        if (!key) return
        if (d.open) this.classesUi.open.add(key)
        else this.classesUi.open.delete(key)
      },
      true,
    )
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
    // Clic hors du champ et des suggestions : suggestions fermées (chemin de l'événement : la cible a pu être
    // remplacée entre-temps, ex. « Réessayer » dans la liste).
    document.addEventListener('click', e => {
      if (!e.composedPath().some(n => n instanceof Element && n.classList.contains('bv-combo'))) this.closeSuggestions()
    })
  }

  // ───────────────────────────── navigation ─────────────────────────────

  /** Affiche la section pour `#boss/<monsterId>[/<onglet>]` (`parts` = segments après « boss »). */
  show(parts: readonly string[]): void {
    this.start()
    const id = Number(parts[0])
    const tab = TABS.find(t => t.id === parts[1])?.id ?? 'fiche'
    if (!parts[0] || !Number.isInteger(id) || id <= 0) {
      this.id = null
    } else {
      if (id !== this.id) {
        this.grade = null
        this.closeSuggestions()
      }
      this.id = id
      this.tab = tab
      this.syncClassesMode()
      this.loadProfile()
      if (tab === 'classes') this.loadClasses()
      // Index perdu (serveur coupé puis rétabli) : rechargé avec la fiche ; boss hors de l'index chargé (Expédition
      // ouverte par son adresse sans la case « Expéditions ») : index complet chargé pour l'en-tête et les grades.
      if (this.entriesError) this.retryEntries()
      else this.ensureEntry()
    }
    this.render()
  }

  private navigate(id: number, tab: BossTab = 'fiche'): void {
    const h = bossHash(id, tab)
    if (location.hash !== h) location.hash = h
    else this.show([String(id), tab])
  }

  private start(): void {
    if (this.started) return
    this.started = true
    void this.loadEntries(false)
    theoryApi
      .presets()
      .then(list => {
        this.presets = list
        // Preset proposé par défaut : Crâ Terre (l'exemple de la documentation), sinon le premier.
        if (!this.stuffForm.preset && !this.stuffForm.roxx) this.stuffForm.preset = list.find(p => p.id === 'cra_terre_mono')?.id ?? list[0]?.id ?? ''
        if (this.tab === 'stuff') this.render()
      })
      .catch(() => {
        /* erreur déjà signalée par l'index des boss */
      })
  }

  private loadEntries(all: boolean): Promise<void> {
    if (this.entries.has(all)) {
      this.afterEntries()
      return Promise.resolve()
    }
    const pending = this.entriesLoading.get(all)
    if (pending) return pending
    const load = theoryApi.bosses(all).then(
      list => {
        this.entries.set(all, list)
        this.entriesError = undefined
      },
      e => {
        this.entriesError = (e as Error).message
      },
    )
    const done = load.then(() => {
      this.entriesLoading.delete(all)
      this.afterEntries()
    })
    this.entriesLoading.set(all, done)
    return done
  }

  /**
   * Nouvel essai après une erreur de l'index : celui de la case « Expéditions » (un index en échec n'est jamais rangé),
   * puis, à son arrivée, l'index complet si le boss affiché en a besoin (`ensureEntry`).
   */
  private retryEntries(): void {
    this.entriesError = undefined
    void this.loadEntries(this.includeExp)
  }

  /**
   * Boss affiché absent de l'index sans Expéditions (Expédition ouverte par son adresse) : charge l'index complet pour
   * l'en-tête (donjon, niveau, « Expédition ») et le nombre de grades. Pas de nouvel essai automatique après une erreur.
   */
  private ensureEntry(): void {
    if (this.id !== null && !this.entriesError && !this.entry && this.entries.has(false) && !this.entries.has(true)) void this.loadEntries(true)
  }

  private afterEntries(): void {
    this.updateSuggestions(!this.list.hidden)
    this.ensureEntry()
    this.render()
  }

  private get bossList(): BossEntry[] {
    return this.entries.get(this.includeExp) ?? this.entries.get(true) ?? this.entries.get(false) ?? []
  }

  private get entry(): BossEntry | undefined {
    return this.id === null ? undefined : [...(this.entries.get(true) ?? []), ...(this.entries.get(false) ?? [])].find(e => e.monsterId === this.id)
  }

  private get scale(): Scale {
    return this.grade !== null ? { grade: this.grade } : { players: this.players }
  }

  private get scaleKey(): string {
    return this.grade !== null ? `g${this.grade}` : `p${this.players}`
  }

  /**
   * Après un changement de boss ou de réglage : le mode « stuffs optimisés » (≈ une optimisation par preset, long et
   * bloquant pour le serveur de développement) n'est gardé que si son résultat existe déjà (ou est en cours) pour la
   * nouvelle clé ; sinon retour aux stuffs des presets, et l'optimisation attend un clic explicite.
   */
  private syncClassesMode(): void {
    if (this.classesMode !== 'optimized' || this.id === null) return
    const have = this.classes.get(`${this.id}|${this.scaleKey}|optimized`)
    if (!have || !(have.value || have.loading)) this.classesMode = 'preset'
  }

  // ───────────────────────────── chargements ─────────────────────────────

  private loadProfile(): void {
    if (this.id === null) return
    const key = `${this.id}|${this.scaleKey}`
    const have = this.profiles.get(key)
    if (have && (have.value || have.loading)) return
    this.request(this.profiles, key, theoryApi.boss(this.id, this.scale))
  }

  private loadClasses(force = false): void {
    if (this.id === null) return
    const key = `${this.id}|${this.scaleKey}|${this.classesMode}`
    const have = this.classes.get(key)
    if (have && !force && (have.value || have.loading)) return
    this.request(this.classes, key, theoryApi.classes(this.id, this.scale, this.classesMode))
  }

  private runStuff(): void {
    if (this.id === null) return
    const f = this.stuffForm
    const key = this.stuffKey
    // Calcul déjà en cours pour ce boss et ce réglage (bouton désactivé ; Entrée dans un champ) : pas de second calcul.
    if (this.stuffs.get(key)?.loading) return
    const previous = this.stuffs.get(key)?.value
    if (!f.preset && !f.roxx.trim()) {
      this.stuffs.set(key, { seq: ++this.seq, loading: false, started: Date.now(), value: previous, error: 'Choisissez un preset, ou collez un lien RoxxSolver (preset automatique).' })
      return this.renderPanel()
    }
    this.sorts.delete('stuff-cmp')
    this.request(
      this.stuffs,
      key,
      theoryApi.stuff(this.id, this.scale, { preset: f.preset || undefined, roxx: f.roxx.trim() || undefined, elements: f.elements, profile: f.profile, top: f.top, iterations: f.iterations }),
      previous,
    )
    // Carte de chargement, chronomètre, bouton désactivé et résultat précédent grisé.
    this.renderPanel()
  }

  private get stuffKey(): string {
    return `${this.id}|${this.scaleKey}`
  }

  /**
   * Lance une demande pour une clé et range sa réponse. Anti-course : chaque demande prend un numéro de séquence ; une
   * réponse n'est rangée que si sa clé n'a pas été redemandée entre-temps (sinon elle est ignorée), et l'affichage
   * ne suit que la clé du boss et du réglage courants. `previous` : résultat gardé à l'écran pendant le calcul et en cas
   * d'erreur. L'appelant redessine (état « en cours ») ; la réponse redessine elle-même.
   */
  private request<T>(map: Map<string, Pending<T>>, key: string, promise: Promise<T>, previous?: T): void {
    const seq = ++this.seq
    map.set(key, { seq, loading: true, started: Date.now(), value: previous })
    const done = (out: { value?: T; error?: string }) => {
      if (map.get(key)?.seq !== seq) return
      map.set(key, { seq, loading: false, started: map.get(key)!.started, value: out.value ?? previous, error: out.error })
      // Affichage : seulement si la réponse concerne le boss et le réglage affichés (sinon elle attend en cache).
      const shown = `${this.id}|${this.scaleKey}`
      if (key === shown || key.startsWith(`${shown}|`)) this.render()
    }
    promise.then(
      value => done({ value }),
      e => done({ error: (e as Error).message }),
    )
  }

  /**
   * Chronomètre des calculs longs : texte « … s » des `[data-elapsed]` (début du calcul) mis à jour chaque seconde. Lancé
   * à chaque rendu du panneau qui en affiche un (retour sur un onglet pendant le calcul compris) ; s'arrête seul quand
   * plus aucun n'est affiché.
   */
  private tick(): void {
    if (this.timer || !this.root.querySelector('[data-elapsed]')) return
    this.timer = window.setInterval(() => {
      const busy = this.root.querySelectorAll<HTMLElement>('[data-elapsed]')
      if (!busy.length) {
        clearInterval(this.timer)
        this.timer = 0
        return
      }
      for (const el of busy) el.textContent = elapsedText(Number(el.dataset.elapsed))
    }, 1000)
  }

  // ───────────────────────────── recherche ─────────────────────────────

  private updateSuggestions(open = true): void {
    const q = this.query.trim()
    this.suggestions = q ? searchBosses(this.bossList, q).slice(0, MAX_SUGGESTIONS) : []
    this.active = this.suggestions.length ? 0 : -1
    const show = open && !!q
    this.list.hidden = !show
    this.input.setAttribute('aria-expanded', String(show))
    this.list.innerHTML = this.suggestions.length
      ? this.suggestions
          .map((b, i) => {
            const d = b.dungeons[0]
            return `<li role="option" id="bv-opt-${i}" class="bv-opt" data-act="pick" data-id="${b.monsterId}" aria-selected="${i === this.active}">
              <b>${esc(b.name)}</b>
              <span>${esc(d?.name ?? 'sans donjon')}${d ? ` · niv. ${d.level}` : ''}${b.dungeons.length > 1 ? ` · +${b.dungeons.length - 1} donjon${b.dungeons.length > 2 ? 's' : ''}` : ''}${b.isExpedition ? ' · Expédition' : ''}</span>
            </li>`
          })
          .join('')
      : q
        ? this.entriesError && !this.entriesLoading.size
          ? `<li class="bv-opt empty retry" role="option" data-act="retry-index" aria-selected="false">${esc(this.entriesError)} <u>Réessayer</u></li>`
          : `<li class="bv-opt empty" role="option" aria-disabled="true">${this.bossList.length ? 'Aucun boss ne correspond.' : 'Chargement de l’index des boss…'}</li>`
        : ''
    this.syncActive()
  }

  private syncActive(): void {
    for (const li of this.list.querySelectorAll<HTMLElement>('[role="option"]')) li.setAttribute('aria-selected', String(li.id === `bv-opt-${this.active}`))
    if (this.active >= 0) {
      this.input.setAttribute('aria-activedescendant', `bv-opt-${this.active}`)
      this.list.querySelector(`#bv-opt-${this.active}`)?.scrollIntoView({ block: 'nearest' })
    } else this.input.removeAttribute('aria-activedescendant')
  }

  private closeSuggestions(): void {
    this.list.hidden = true
    this.input.setAttribute('aria-expanded', 'false')
    this.input.removeAttribute('aria-activedescendant')
  }

  private pick(id: number): void {
    this.query = ''
    this.input.value = ''
    this.closeSuggestions()
    this.navigate(id, this.id === null ? 'fiche' : this.tab)
  }

  // ───────────────────────────── événements ─────────────────────────────

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el === this.input) {
      this.query = el.value
      this.updateSuggestions()
      if (this.id === null) this.renderLanding()
      return
    }
    if (el.form?.id === 'bv-stuff-form' && el.name === 'roxx') this.stuffForm.roxx = el.value
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    if (el.id === 'bv-exp') {
      this.includeExp = (el as HTMLInputElement).checked
      void this.loadEntries(this.includeExp)
      return
    }
    const act = el.dataset.act
    if (act === 'players' || act === 'grade') {
      if (act === 'players') {
        this.players = Number(el.value)
        this.grade = null
      } else this.grade = el.value ? Number(el.value) : null
      this.syncClassesMode()
      this.loadProfile()
      if (this.tab === 'classes') this.loadClasses()
      return this.render()
    }
    if ((el as HTMLInputElement).form?.id === 'bv-stuff-form') {
      const f = this.stuffForm
      switch (el.name) {
        case 'preset':
          f.preset = el.value
          break
        case 'roxx':
          f.roxx = el.value
          break
        case 'elements':
          f.elements = el.value === 'all' ? 'all' : 'preset'
          break
        case 'profile':
          f.profile = el.value as StuffForm['profile']
          break
        case 'top':
          f.top = Number(el.value)
          break
        case 'iterations':
          f.iterations = Number(el.value)
          break
      }
    }
  }

  private onSubmit(e: Event): void {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    if (form.id === 'bv-stuff-form') return this.runStuff()
    // Recherche : Entrée choisit la suggestion active.
    const b = this.suggestions[this.active]
    if (b) this.pick(b.monsterId)
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target !== this.input) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.suggestions.length) return
      e.preventDefault()
      if (this.list.hidden) this.updateSuggestions()
      const n = this.suggestions.length
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      this.syncActive()
    } else if (e.key === 'Escape') {
      if (!this.list.hidden) {
        e.preventDefault()
        this.closeSuggestions()
      }
    }
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!t || !this.root.contains(t) || t instanceof HTMLSelectElement) return
    switch (t.dataset.act) {
      case 'pick':
        if (t.dataset.id) this.pick(Number(t.dataset.id))
        return
      case 'sort': {
        const table = t.dataset.table!
        this.sorts.set(table, nextSort(this.sortOf(table), t.dataset.key!, t.dataset.dir === '1' ? 1 : -1))
        return this.id === null ? this.renderLanding() : this.renderPanel()
      }
      case 'row': {
        const k = t.dataset.key!
        if (this.classesUi.open.has(k)) this.classesUi.open.delete(k)
        else this.classesUi.open.add(k)
        return this.renderPanel()
      }
      case 'axis':
        this.classesUi.axis = t.dataset.axis as ClassesUi['axis']
        return this.renderPanel()
      case 'optimize':
        this.classesMode = 'optimized'
        this.loadClasses()
        return this.renderPanel()
      case 'preset-mode':
        this.classesMode = 'preset'
        this.loadClasses()
        return this.renderPanel()
      case 'retry-classes':
        this.loadClasses(true)
        return this.renderPanel()
      case 'retry-profile':
        this.profiles.delete(`${this.id}|${this.scaleKey}`)
        this.loadProfile()
        if (this.entriesError) this.retryEntries()
        return this.render()
      case 'retry-index':
        this.retryEntries()
        this.updateSuggestions(!this.list.hidden)
        return this.render()
      case 'to-stuff':
        this.stuffForm.preset = t.dataset.preset ?? ''
        if (this.id !== null) this.navigate(this.id, 'stuff')
        return
    }
  }

  private sortOf(table: string): SortState | undefined {
    return this.sorts.get(table) ?? defaultClassesSort(table)
  }

  // ───────────────────────────── rendu ─────────────────────────────

  private render(): void {
    const e = this.entry
    const title = this.root.querySelector('#bv-title')!
    const kicker = this.root.querySelector('#bv-kicker')!
    kicker.innerHTML =
      this.id === null ? 'Theorycraft · un joueur contre un boss' : '<a class="bv-back" href="#boss">Tous les boss</a><span aria-hidden="true"> › </span>theorycraft'
    if (this.id === null) {
      title.textContent = 'Boss'
      this.onTitle('Boss · DofusSimu')
      return this.renderLanding()
    }
    const p = this.profiles.get(`${this.id}|${this.scaleKey}`)
    const name = p?.value?.name ?? e?.name ?? `Monstre ${this.id}`
    title.textContent = name
    this.onTitle(`${name} · Boss · DofusSimu`)
    if (p?.error && !p.value && !e && this.entries.size) {
      // Id absent de l'index des boss : l'erreur de l'API seule, et le retour à la liste.
      this.main.innerHTML = `${errorBox(p.error)}<a class="btn" href="#boss">Tous les boss</a>`
      return
    }
    this.main.innerHTML = `${this.hero(p?.value, e)}
      <nav class="bv-tabs" aria-label="Onglets du boss">${TABS.map(
        t => `<a class="bv-tab" href="${bossHash(this.id!, t.id)}"${t.id === this.tab ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`,
      ).join('')}</nav>
      <div id="bv-panel" class="bv-panel"></div>`
    this.renderPanel()
  }

  /** En-tête du boss : donjon, niveau, grade, réglage joueurs / grade. */
  private hero(p: BossProfileDetail | undefined, e: BossEntry | undefined): string {
    const d = e?.dungeons[0]
    // Nombre de grades inconnu tant que l'index n'est pas chargé : 5 (donjons modulaires), corrigé à son arrivée.
    const gradeCount = e?.gradeCount ?? 5
    const autoGrade = bossGradeFor(this.players, gradeCount)
    const players = Array.from({ length: 8 }, (_, i) => i + 1)
      .map(n => `<option value="${n}"${n === this.players ? ' selected' : ''}>${n} joueur${n > 1 ? 's' : ''}</option>`)
      .join('')
    const grades =
      `<option value=""${this.grade === null ? ' selected' : ''}>Selon les joueurs (${autoGrade})</option>` +
      Array.from({ length: gradeCount }, (_, i) => i + 1)
        .map(g => `<option value="${g}"${g === this.grade ? ' selected' : ''}>Grade ${g}</option>`)
        .join('')
    const facts = [
      d ? `${esc(d.name)} · donjon niv. ${d.level}` : '',
      p ? `boss niv. ${p.level}` : e ? `boss niv. ${e.bossLevel}` : '',
      p ? `grade ${p.grade}${p.players !== undefined ? ` (${p.players} joueur${p.players > 1 ? 's' : ''})` : ' (imposé)'}` : '',
      e?.isExpedition ? 'Expédition' : '',
    ].filter(Boolean)
    return `<section class="panel bv-hero">
      <div class="bv-hero-text">
        <p class="bv-facts">${facts.join('<span aria-hidden="true"> · </span>')}</p>
        <p class="bv-badges">${
          p?.overrides
            ? `<span class="bv-chip manual" title="data/bosses/${this.id}.json">fiche manuelle${p.overrides.updatedAt ? ` du ${esc(p.overrides.updatedAt)}` : ''}</span>`
            : p
              ? `<span class="bv-chip" title="Aucune fiche data/bosses/${this.id}.json">données DofusDB seules</span>`
              : ''
        }<span class="bv-chip">id ${this.id}</span></p>
      </div>
      <div class="bv-scale">
        <label class="bv-field"><span>Joueurs</span><span class="select-wrap"><select data-act="players" aria-label="Nombre de joueurs">${players}</select></span></label>
        <label class="bv-field"><span>Grade</span><span class="select-wrap"><select data-act="grade" aria-label="Grade du boss">${grades}</select></span></label>
      </div>
    </section>`
  }

  private renderPanel(): void {
    const panel = this.root.querySelector<HTMLElement>('#bv-panel')
    if (!panel || this.id === null) return
    if (this.tab === 'classes') panel.innerHTML = this.classesPanel()
    else if (this.tab === 'stuff') panel.innerHTML = this.stuffPanel()
    else panel.innerHTML = this.sheetPanel()
    this.tick()
  }

  private sheetPanel(): string {
    const p = this.profiles.get(`${this.id}|${this.scaleKey}`)
    if (!p || p.loading) return spinner('Calcul de la fiche du boss…')
    if (p.error || !p.value) return `${errorBox(p.error ?? 'Fiche indisponible.')}<button class="btn" type="button" data-act="retry-profile">Réessayer</button>`
    return renderSheet(p.value, this.entry)
  }

  private classesPanel(): string {
    const optimized = this.classesMode === 'optimized'
    const key = `${this.id}|${this.scaleKey}|${this.classesMode}`
    const c = this.classes.get(key)
    const n = this.presets.length ? `des ${this.presets.length} presets` : 'des presets'
    // « Revenir » reste actif pendant l'optimisation : la réponse tardive est gardée en cache sans changer l'affichage.
    const toolbar = `<div class="bv-toolbar panel">
      <div><b>${optimized ? 'Stuffs optimisés contre ce boss' : 'Stuffs génériques des presets'}</b>
        <span class="bv-muted">${optimized ? 'un stuff optimisé par preset (montée par coordonnées, graines sans stuffs du Vortex)' : 'stuffs méta partagés entre classes d’un même élément'}</span></div>
      ${
        optimized
          ? `<button class="btn" type="button" data-act="preset-mode">Revenir aux stuffs des presets</button>`
          : `<button class="btn primary" type="button" data-act="optimize" title="Optimise le stuff de chacun ${n} contre ce boss (calcul long : une optimisation par preset)">Optimiser les stuffs</button>`
      }
    </div>`
    if (!c || c.loading) {
      const started = c?.started ?? Date.now()
      return `${toolbar}<div class="bv-loading-card panel">${spinner(
        optimized
          ? `Optimisation du stuff de chacun ${n} contre ce boss (une optimisation par preset : calcul long, le serveur de développement est occupé pendant ce temps)…`
          : `Évaluation ${n} contre ce boss…`,
      )}<span class="bv-elapsed" data-elapsed="${started}">${elapsedText(started)}</span></div>`
    }
    if (c.error || !c.value) return `${toolbar}${errorBox(c.error ?? 'Classement indisponible.')}<button class="btn" type="button" data-act="retry-classes">Réessayer</button>`
    return toolbar + renderClasses(c.value, this.classesUi)
  }

  private stuffPanel(): string {
    const s = this.stuffs.get(this.stuffKey)
    const busy = !!s?.loading
    let out = ''
    if (s?.loading)
      out += `<div class="bv-loading-card panel">${spinner('Optimisation du stuff contre ce boss…')}<span class="bv-elapsed" data-elapsed="${s.started}">${elapsedText(s.started)}</span></div>`
    if (s?.error) out += errorBox(s.error)
    if (s?.value) out += `<div class="bv-result${s.loading ? ' stale' : ''}">${renderStuffResult(s.value, this.sorts.get('stuff-cmp'))}</div>`
    else if (!s) out += '<p class="bv-hint">Choisissez un preset (ou collez le lien RoxxSolver de votre stuff), puis lancez le calcul.</p>'
    return renderStuffForm(this.stuffForm, this.presets, busy) + out
  }

  /** Accueil : liste des boss (filtrée par la recherche). */
  private renderLanding(): void {
    if (this.id !== null) return
    if (this.entriesError && !this.entriesLoading.size)
      return void (this.main.innerHTML = `${errorBox(this.entriesError)}<button class="btn" type="button" data-act="retry-index">Réessayer</button>`)
    const all = this.bossList
    if (!all.length) return void (this.main.innerHTML = spinner('Chargement de l’index des boss…'))
    const q = this.query.trim()
    const rows = q ? searchBosses(all, q) : all
    const cols: Column<BossEntry>[] = [
      { key: 'name', label: 'Boss', sort: b => b.name, cell: b => `<a class="bv-boss-link" href="${bossHash(b.monsterId)}">${esc(b.name)}</a>${b.isExpedition ? ' <span class="bv-chip">Expédition</span>' : ''}` },
      { key: 'dungeon', label: 'Donjon', sort: b => b.dungeons[0]?.name ?? '', cell: b => esc(b.dungeons.map(d => d.name).join(' · ')) },
      { key: 'level', label: 'Niv. donjon', num: true, sort: b => b.dungeons[0]?.level ?? 0, cell: b => String(b.dungeons[0]?.level ?? '—') },
      { key: 'boss', label: 'Niv. boss', num: true, sort: b => b.bossLevel, cell: b => String(b.bossLevel) },
      { key: 'grades', label: 'Grades', num: true, sort: b => b.gradeCount, cell: b => String(b.gradeCount) },
      { key: 'id', label: 'Id', num: true, sort: b => b.monsterId, cell: b => `<span class="bv-muted">${b.monsterId}</span>` },
    ]
    this.main.innerHTML = `<section class="panel bv-card bv-landing">
      <header class="panel-head"><h2>${q ? `${fmtNum(rows.length)} boss pour « ${esc(q)} »` : `${fmtNum(all.length)} boss${this.includeExp ? ' (Expéditions comprises)' : ''}`}</h2>
        <span class="hint">fiche, classes et meilleur stuff contre chacun</span></header>
      <p class="bv-pad bv-note">Theorycraft déterministe : aucun combat simulé, chaque chiffre a sa décomposition. Les classements valent plus que les valeurs absolues. Réglez ensuite le nombre de joueurs (4 par défaut ⇒ grade 1).</p>
      ${rows.length ? sortableTable('bosses', cols, rows, this.sorts.get('bosses'), { cls: 'bv-bosses' }) : '<p class="bv-pad bv-muted">Aucun boss ne correspond.</p>'}
    </section>`
  }
}
