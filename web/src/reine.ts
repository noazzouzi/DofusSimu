/**
 * Section « Reine » du visualiseur (`#reine`) : planificateur de tour contre la Reine des Voleurs (4 Crâs,
 * tools/reine-des-voleurs/planificateur). Serveur de développement seulement (`npm run dev`, API web/plugins/reine.ts).
 *
 *  - état du combat : dernier tour enregistré par le journal AnkaBot (direct), un tour du dernier combat, ou un nouveau
 *    combat (placement à ajuster) ; édition sur la carte (cliquer une entité puis une case) ; Crâ qui joue au choix ;
 *  - zones de danger des cases accessibles au Crâ qui joue : sûre, touchable par un monstre, mort par bombe ;
 *  - meilleurs tours (sûrs, puis non sûrs pour comparaison) : chemin, case de tir, sorts et cibles, case de repli ;
 *    « Animer » rejoue le tour dans la section « Combats » ;
 *  - meilleur round de l'équipe : les tours des 4 Crâs cherchés ensemble, monstres simulés entre deux Crâs ; chaque
 *    tour se voit sur la carte dans l'état où le Crâ le joue, et le round complet s'anime dans « Combats » ;
 *  - placement optimisé : pour les positions des monstres de l'état chargé, cases rouges des 4 Crâs (potentiel de chaque
 *    case sur la carte) et meilleur round avec ce placement ; « Appliquer » charge ce placement.
 *
 * Le rendu est celui de la section « Combats » (StageRenderer) avec ses couches `marks` et `links`.
 */
import { initialState } from '@/replay/reducer'
import type { Replay, ViewState } from '@/replay/types'
import { StageRenderer, type CellLink, type CellMark } from './render/renderer'
import { readPalette, withAlpha } from './theme'
import { reineApi, type JournalInfo, type PlanResult, type ReineView, type Snapshot, type WebPlacement, type WebPlan, type WebTeam } from './reine-api'
import './reine.css'

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR')
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'

type Source = 'direct' | 'nouveau' | { round: number; player: number }

export class ReineSection {
  private journal: JournalInfo | null = null
  private view: ReineView | null = null
  private state: ViewState | null = null
  private result: PlanResult | null = null
  /** Résultat calculé pour un autre état que celui affiché (positions modifiées depuis). */
  private stale = false
  private planSel: { list: 'plans' | 'unsafe'; i: number } | null = null
  /** Meilleur round de l'équipe, et tour de Crâ affiché sur la carte (état au début de son tour). */
  private team: WebTeam | null = null
  private teamSel: number | null = null
  /** Placement optimisé (le meilleur round correspondant est dans `team`). */
  private placement: WebPlacement | null = null
  /** Entité sélectionnée pour un déplacement (index dans snapshot.entities = identifiant moteur). */
  private selected: number | null = null
  private hoverCell = -1
  private showDanger = true
  private busy = ''
  private seq = 0
  private started = false
  private readonly renderer: StageRenderer
  private readonly canvas: HTMLCanvasElement
  private readonly stage: HTMLElement
  private readonly side: HTMLElement
  private readonly info: HTMLElement
  private readonly sourceSel: HTMLSelectElement
  private readonly activeSel: HTMLSelectElement

  constructor(
    readonly root: HTMLElement,
    private readonly openReplay: (replay: Replay, label: string) => void,
  ) {
    root.innerHTML = `
      <div class="rv-wrap">
        <header class="rv-head">
          <div>
            <h1 id="rv-title">Reine des Voleurs · planificateur de tour</h1>
            <p class="rv-sub">Meilleur tour du Crâ qui joue : le plus de dégâts sans finir à portée d'un monstre ni dans l'axe d'une bombe qui explose.</p>
          </div>
          <div class="rv-toolbar">
            <label class="rv-field">État
              <span class="select-wrap"><select id="rv-source"></select></span>
            </label>
            <button class="btn" id="rv-load" type="button">Charger</button>
            <label class="rv-field">Crâ qui joue
              <span class="select-wrap"><select id="rv-active"></select></span>
            </label>
            <button class="btn rv-primary" id="rv-plan" type="button">Calculer les meilleurs tours</button>
            <button class="btn rv-primary" id="rv-team" type="button">Meilleur round (4 Crâs)</button>
            <button class="btn" id="rv-place" type="button">Optimiser le placement</button>
            <label class="rv-check"><input type="checkbox" id="rv-danger" checked /> Zones de danger</label>
          </div>
        </header>
        <div class="rv-body">
          <section class="rv-stage-col">
            <div class="rv-stage" id="rv-stage"><canvas id="rv-canvas" aria-label="Carte du combat"></canvas></div>
            <p class="rv-info" id="rv-info"></p>
            <ul class="rv-legend">
              <li><i class="sw safe"></i>case sûre</li>
              <li><i class="sw threat"></i>touchable par un monstre</li>
              <li><i class="sw bomb"></i>mort par bombe</li>
              <li><i class="sw path"></i>déplacement</li>
              <li><i class="sw end"></i>fin du tour</li>
              <li><i class="sw cast"></i>sort lancé</li>
            </ul>
          </section>
          <aside class="rv-side" id="rv-side"></aside>
        </div>
      </div>`
    const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
    this.canvas = $<HTMLCanvasElement>('rv-canvas')
    this.stage = $('rv-stage')
    this.side = $('rv-side')
    this.info = $('rv-info')
    this.sourceSel = $<HTMLSelectElement>('rv-source')
    this.activeSel = $<HTMLSelectElement>('rv-active')
    this.renderer = new StageRenderer(this.canvas, readPalette())
    $('rv-load').addEventListener('click', () => void this.load(this.sourceValue()))
    $('rv-plan').addEventListener('click', () => void this.plan())
    $('rv-team').addEventListener('click', () => void this.planTeam())
    $('rv-place').addEventListener('click', () => void this.optimizePlacement())
    $<HTMLInputElement>('rv-danger').addEventListener('change', e => {
      this.showDanger = (e.target as HTMLInputElement).checked
      this.updateMarks()
    })
    this.activeSel.addEventListener('change', () => {
      if (!this.view) return
      void this.edit(s => ({ ...s, active: Number(this.activeSel.value) }))
    })
    this.side.addEventListener('click', e => this.onSideClick(e))
    this.bindCanvas()
    new ResizeObserver(() => this.fit()).observe(this.stage)
  }

  /** Section affichée : premier chargement (journal, puis état direct ou nouveau combat), boucle de rendu. */
  show(): void {
    this.renderer.setPalette(readPalette())
    if (!this.started) {
      this.started = true
      this.loop()
      void this.init()
    }
    this.fit()
  }

  private async init(): Promise<void> {
    try {
      this.journal = await reineApi.journal()
    } catch (e) {
      this.error((e as Error).message)
      return
    }
    const opts = [
      this.journal.turns.length ? `<option value="direct">Direct : dernier tour enregistré</option>` : '',
      `<option value="nouveau">Nouveau combat (placement à ajuster)</option>`,
      this.journal.turns.length
        ? `<optgroup label="Dernier combat du journal (${esc(this.journal.day ?? '')})">${this.journal.turns
            .map(t => `<option value="j:${t.round}:${t.player}">Manche ${t.round} — ${esc(t.name)}</option>`)
            .join('')}</optgroup>`
        : '',
    ]
    this.sourceSel.innerHTML = opts.join('')
    await this.load(this.journal.turns.length ? 'direct' : 'nouveau')
  }

  private sourceValue(): Source {
    const v = this.sourceSel.value
    if (v === 'direct' || v === 'nouveau') return v
    const [, r, p] = v.split(':')
    return { round: Number(r), player: Number(p) }
  }

  // ───────────────────────────── chargement et édition ─────────────────────────────

  private async load(source: Source): Promise<void> {
    await this.run('Chargement de l’état…', async () => this.setView(await reineApi.etat(source), true))
  }

  /** Modifie l'instantané (déplacement, Crâ qui joue…) et fait recalculer bombe et dangers par le serveur. */
  private async edit(change: (s: Snapshot) => Snapshot): Promise<void> {
    if (!this.view) return
    const snap = change(structuredClone(this.view.snapshot))
    await this.run('Mise à jour…', async () => {
      const v = await reineApi.vue(snap)
      this.setView({ ...v, actual: this.view?.actual, notice: this.view?.notice }, false)
      if (this.result || this.team) this.stale = true
      this.placement = null
    })
  }

  private setView(v: ReineView, fresh: boolean): void {
    this.view = v
    if (fresh) {
      this.result = null
      this.team = null
      this.placement = null
      this.stale = false
      this.planSel = null
    }
    this.teamSel = null
    this.selected = null
    if (v.replay.map) this.renderer.setMap(v.replay.map, [])
    this.display()
    const cras = v.snapshot.entities.filter(e => e.kind === 'cra')
    this.activeSel.innerHTML = cras.map(e => `<option value="${e.gameId}">${esc(e.name)}</option>`).join('')
    this.activeSel.value = String(v.snapshot.active)
    this.fit()
    this.updateMarks()
    this.renderSide()
  }

  private async plan(): Promise<void> {
    if (!this.view) return
    const snap = this.view.snapshot
    await this.run('Recherche des meilleurs tours… (1 à 3 s)', async () => {
      this.result = await reineApi.plan(snap, 5)
      this.stale = false
      this.planSel = this.result.plans.length ? { list: 'plans', i: 0 } : this.result.unsafe.length ? { list: 'unsafe', i: 0 } : null
      this.updateMarks()
      this.renderSide()
    })
  }

  private async planTeam(): Promise<void> {
    if (!this.view) return
    const snap = this.view.snapshot
    await this.run('Recherche du meilleur round de l’équipe… (15 à 30 s)', async () => {
      this.team = await reineApi.team(snap)
      this.stale = false
      this.teamSel = null
      this.display()
      this.updateMarks()
      this.renderSide()
    })
  }

  private async optimizePlacement(): Promise<void> {
    if (!this.view) return
    const snap = this.view.snapshot
    await this.run('Optimisation du placement des Crâs… (≈ 1 min)', async () => {
      const res = await reineApi.placement(snap)
      this.placement = res
      this.team = res.team
      this.result = null
      this.stale = false
      this.teamSel = null
      this.display()
      this.updateMarks()
      this.renderSide()
    })
  }

  /** Charge le placement optimisé comme état courant (meilleur round et placement gardés). */
  private async applyPlacement(): Promise<void> {
    const pl = this.placement
    if (!pl) return
    await this.run('Chargement du placement…', async () => {
      const v = await reineApi.vue(pl.snapshot)
      const team = this.team
      this.setView({ ...v, notice: this.view?.notice }, true)
      this.team = team
      this.placement = pl
      this.updateMarks()
      this.renderSide()
    })
  }

  /** État affiché sur la carte : celui du tour de Crâ choisi dans le meilleur round, sinon l'état chargé. */
  private display(): void {
    const t = this.teamSel !== null && !this.stale ? this.team?.turns[this.teamSel] : undefined
    const replay = t?.replay ?? this.view?.replay
    if (!replay) return
    this.state = initialState(replay)
    this.renderer.selected = this.selected
    this.renderer.snap(this.state)
    this.renderer.invalidate()
  }

  private async animate(p: WebPlan, rank: string): Promise<void> {
    if (!this.view) return
    const snap = this.view.snapshot
    const who = snap.entities.find(e => e.gameId === snap.active)?.name ?? 'Crâ'
    const title = `Reine — ${who}, manche ${snap.round} : tour ${rank} (${fmt(p.total)} dégâts)`
    await this.run('Préparation de l’animation…', async () => this.openReplay(await reineApi.animation(snap, p.steps, title), title))
  }

  /** Exécute une action réseau : un seul calcul à la fois, état « occupé » et erreurs affichées. */
  private async run(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return
    const seq = ++this.seq
    this.busy = label
    this.renderSide()
    try {
      await fn()
    } catch (e) {
      if (seq === this.seq) this.error((e as Error).message)
    } finally {
      if (seq === this.seq) {
        this.busy = ''
        this.renderSide()
      }
    }
  }

  private error(message: string): void {
    this.side.querySelector('.rv-error')?.remove()
    this.side.insertAdjacentHTML('afterbegin', `<div class="rv-card rv-error" role="alert">${esc(message)}</div>`)
  }

  // ───────────────────────────── carte ─────────────────────────────

  private loop(): void {
    const tick = (t: number) => {
      if (this.state && !this.root.hidden && this.renderer.busy(t)) this.renderer.frame(this.state, t, 16)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  private fit(): void {
    const w = this.stage.clientWidth
    if (!w || !this.view) return
    const top = this.stage.getBoundingClientRect().top + window.scrollY
    const wide = window.innerWidth > 900
    const maxH = wide ? Math.max(380, window.innerHeight - top - 90) : Math.max(280, window.innerHeight * 0.6)
    this.renderer.resize(w, maxH, window.devicePixelRatio || 1)
    this.renderer.invalidate()
  }

  private walkable(cell: number): boolean {
    return !!this.view?.replay.map?.cells[cell]?.walkable
  }

  private bindCanvas(): void {
    const local = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    this.canvas.addEventListener('pointermove', e => {
      const { x, y } = local(e)
      const hit = this.renderer.pick(x, y)
      if (hit.cell === this.hoverCell && hit.fighter === this.renderer.hover) return
      this.hoverCell = hit.cell
      this.renderer.hover = hit.fighter
      this.renderer.hoverCell = hit.cell
      this.canvas.classList.toggle('pointer', hit.fighter !== null || this.selected !== null)
      this.info.innerHTML = this.cellInfo(hit.cell, hit.fighter)
      this.renderer.invalidate()
    })
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverCell = -1
      this.renderer.hover = null
      this.renderer.hoverCell = -1
      this.info.innerHTML = this.cellInfo(-1, null)
      this.renderer.invalidate()
    })
    this.canvas.addEventListener('click', e => {
      if (!this.view || this.busy) return
      // Un tour du meilleur round est affiché : un clic revient à l'état chargé (seul état modifiable).
      if (this.teamSel !== null) {
        this.teamSel = null
        this.display()
        this.updateMarks()
        this.renderSide()
        return
      }
      const { x, y } = local(e)
      const hit = this.renderer.pick(x, y)
      if (this.selected !== null && hit.fighter === null && hit.cell >= 0 && this.walkable(hit.cell)) {
        const i = this.selected
        void this.edit(s => {
          s.entities[i].cell = hit.cell
          return s
        })
        return
      }
      this.selected = hit.fighter !== null && hit.fighter !== this.selected ? hit.fighter : null
      this.renderer.selected = this.selected
      // Écran tactile (pas de survol) : un appui sur une case en donne les dangers.
      this.hoverCell = hit.cell
      this.info.innerHTML = this.selected !== null ? this.cellInfo(-1, null) : this.cellInfo(hit.cell, hit.fighter)
      this.updateMarks()
      this.renderSide()
    })
  }

  /** Texte sous la carte : la case survolée (danger, entité) ou l'aide d'édition. */
  private cellInfo(cell: number, fighter: number | null): string {
    const v = this.view
    if (!v) return ''
    if (this.teamSel !== null) {
      const f = fighter !== null ? this.state?.fighters[fighter] : undefined
      const head = f ? `<b>${esc(f.name)}</b> en ${f.cell} · ${fmt(f.hp)}/${fmt(f.maxHp)} PV` : cell >= 0 ? `Case ${cell}` : ''
      return `${head ? `${head} · ` : ''}État au début du tour de ${esc(this.team?.turns[this.teamSel]?.name ?? '')} (meilleur round). Cliquez la carte pour revenir à l'état chargé.`
    }
    const ent = fighter !== null ? v.snapshot.entities[fighter] : undefined
    const parts: string[] = []
    if (ent) parts.push(`<b>${esc(ent.name)}</b> en ${ent.cell}${ent.hp !== undefined ? ` · ${fmt(ent.hp)}/${fmt(ent.maxHp ?? ent.hp)} PV` : ''}`)
    else if (cell >= 0) parts.push(`Case ${cell}`)
    const d = v.danger.find(x => x.cell === cell)
    if (d) {
      parts.push(`${d.mp} PM`)
      if (d.bombDeath) parts.push(`<span class="bad">mort par bombe d'ici son prochain tour</span>`)
      if (d.alliesKilled.length) parts.push(`<span class="bad">tue ${esc(d.alliesKilled.join(', '))} (explosion de fin de tour)</span>`)
      if (d.threats.length) parts.push(`<span class="warn">touchable : ${esc(d.threats.map(t => `${t.monster} (${t.spell} depuis ${t.from}${t.viaSwap !== undefined ? `, après échange en ${t.viaSwap}` : ''})`).join(' ; '))}</span>`)
      if (!d.bombDeath && !d.alliesKilled.length && !d.threats.length) parts.push(`<span class="good">sûre</span>`)
    }
    if (!parts.length || cell < 0) {
      return this.selected !== null
        ? `Cliquez une case libre pour déplacer <b>${esc(v.snapshot.entities[this.selected].name)}</b> (ou l'entité pour annuler).`
        : 'Survolez une case pour voir ses dangers. Cliquez une entité puis une case pour la déplacer.'
    }
    return parts.join(' · ')
  }

  private currentPlan(): WebPlan | null {
    if (this.teamSel !== null) return this.team?.turns[this.teamSel]?.plan ?? null
    if (!this.result || !this.planSel) return null
    return this.result[this.planSel.list][this.planSel.i] ?? null
  }

  /** Couches de la carte : dangers ou tour choisi, entité sélectionnée, bombes qui explosent à la fin du tour. */
  private updateMarks(): void {
    const v = this.view
    const marks: CellMark[] = []
    const links: CellLink[] = []
    if (v) {
      const red = cssVar('--damage')
      const green = cssVar('--hp-high')
      const orange = cssVar('--team1-2')
      const blue = cssVar('--team0')
      const gold = cssVar('--gold')
      const accent = cssVar('--accent')
      const p = this.stale ? null : this.currentPlan()
      if (this.showDanger && !p) {
        const bomb = v.danger.filter(d => d.bombDeath || d.alliesKilled.length).map(d => d.cell)
        const threat = v.danger.filter(d => !d.bombDeath && !d.alliesKilled.length && d.threats.length).map(d => d.cell)
        const safe = v.danger.filter(d => !d.bombDeath && !d.alliesKilled.length && !d.threats.length).map(d => d.cell)
        marks.push({ cells: safe, fill: withAlpha(green, 0.32) }, { cells: threat, fill: withAlpha(orange, 0.32) }, { cells: bomb, fill: withAlpha(red, 0.32) })
      }
      if (p) {
        let n = 0
        for (const s of p.steps) {
          if (s.kind === 'move') marks.push({ cells: s.path.slice(1), stroke: blue, dashed: true, width: 1.8 })
          else {
            n++
            links.push({ from: p.shootCell, to: s.cell, color: withAlpha(accent, 0.85) })
            marks.push({ cells: [s.cell], stroke: accent, label: String(n), inset: 4 })
          }
        }
        marks.push({ cells: [p.shootCell], stroke: gold, width: 2.6, inset: 1 })
        marks.push({ cells: [p.endCell], fill: withAlpha(p.safe ? green : red, 0.35), stroke: p.safe ? green : red, width: 2.4, label: 'Fin' })
      }
      // Placement optimisé : potentiel de chaque case rouge (dégâts du meilleur tour d'un Crâ seul), cases retenues.
      if (this.placement && !p && this.teamSel === null) {
        const chosen = new Set(this.placement.team.placement.map(x => x.cell))
        for (const c of this.placement.potentials) {
          marks.push({ cells: [c.cell], stroke: chosen.has(c.cell) ? gold : c.safe ? green : orange, width: chosen.has(c.cell) ? 3 : 1.4, label: `${(c.total / 1000).toFixed(1)}k`, inset: 1 })
        }
      }
      // Bombes du Crâ qui joue posées à la manche précédente : elles explosent à la fin de ce tour.
      const due = v.snapshot.entities.filter(e => e.kind === 'bomb' && e.owner === v.snapshot.active && e.born === v.snapshot.round - 1)
      if (due.length && this.teamSel === null) marks.push({ cells: due.map(e => e.cell), stroke: red, width: 2.4, dashed: true })
      if (this.selected !== null && this.teamSel === null) marks.push({ cells: [v.snapshot.entities[this.selected].cell], stroke: cssVar('--focus'), width: 2.6, dashed: true, inset: 0.5 })
    }
    this.renderer.marks = marks
    this.renderer.links = links
    this.renderer.invalidate()
  }

  // ───────────────────────────── panneau ─────────────────────────────

  private renderSide(): void {
    const v = this.view
    const err = this.side.querySelector('.rv-error')?.outerHTML ?? ''
    if (!v) {
      this.side.innerHTML = `${err}<div class="rv-card">${this.busy ? `<p class="rv-busy">${esc(this.busy)}</p>` : '<p>Chargement…</p>'}</div>`
      return
    }
    const s = v.snapshot
    const name = (gid?: number) => s.entities.find(e => e.gameId === gid)?.name ?? String(gid)
    const row = (i: number) => {
      const e = s.entities[i]
      const sel = this.selected === i ? ' sel' : ''
      const extra =
        e.kind === 'bomb'
          ? `de ${esc(name(e.owner))}, manche ${e.born}${e.blue ? ', <b>bleue</b>' : ''}${e.owner === s.active && e.born === s.round - 1 ? ' · <span class="bad">explose à la fin de ce tour</span>' : ''}`
          : e.hp !== undefined
            ? `${fmt(e.hp)}/${fmt(e.maxHp ?? e.hp)} PV`
            : ''
      const del = e.kind === 'bomb' ? `<button class="rv-x" data-del="${i}" type="button" title="Retirer cette bombe">×</button>` : ''
      return `<li class="rv-ent ${e.kind}${e.gameId === s.active ? ' active' : ''}${sel}" data-ent="${i}"><span class="n">${esc(e.name)}</span><span class="c">${e.cell}</span><span class="x">${extra}</span>${del}</li>`
    }
    const idx = (k: string) => s.entities.map((e, i) => (e.kind === k ? i : -1)).filter(i => i >= 0)
    const actual = v.actual
      ? `<div class="rv-card"><h4>Ce qui a été joué</h4><p>${esc(v.actual.casts.join(', ') || 'aucun sort')}${v.actual.endCell !== undefined ? ` ; fin en ${v.actual.endCell}` : ''} ; <b>${fmt(v.actual.damage)}</b> dégâts réels.</p>
        <p><button class="btn" type="button" data-round="${s.round}">Rejouer la manche ${s.round} (monstres simulés)</button></p></div>`
      : ''
    const plans = this.renderPlacement() + this.renderTeam() + this.renderPlans()
    this.side.innerHTML = `${err}
      ${this.busy ? `<div class="rv-card rv-busy" role="status">${esc(this.busy)}</div>` : ''}
      <div class="rv-card">
        <h4>État — manche ${s.round}, tour de ${esc(name(s.active))}</h4>
        ${v.notice ? `<p class="rv-notice${v.notice.stale ? ' stale' : ''}">${esc(v.notice.text)}</p>` : ''}
        <p class="rv-src">${esc(s.source ?? '')}</p>
        <ul class="rv-ents">${[...idx('cra'), ...idx('monster'), ...idx('bomb')].map(row).join('')}</ul>
      </div>
      ${actual}
      ${plans}`
  }

  /** Carte d'un tour planifié : `key` identifie le tour pour les boutons (`data-show`, `data-anim`, `data-plan`). */
  private planCard(p: WebPlan, key: string, title: string, on: boolean, anim: boolean): string {
    let n = 0
    const steps = p.steps
      .map(st => (st.kind === 'move' ? `<li class="mv">Déplacement ${st.path.join(' → ')}</li>` : `<li><b>${++n}.</b> ${esc(st.spellName)} → ${st.target ? esc(st.target) + ` (${st.cell})` : `case ${st.cell}`}</li>`))
      .join('')
    const warn = [
      ...p.threats.slice(0, 3).map(t => `<li class="bad">${esc(t.monster)} peut toucher ${p.endCell} (${esc(t.spell)} depuis ${t.from}${t.viaSwap !== undefined ? `, après échange en ${t.viaSwap}` : ''})</li>`),
      ...p.bombDeaths.map(d => `<li class="bad">${esc(d.name)} tué par une bombe ${d.atActiveEnd ? 'à la fin de ce tour' : `(manche ${d.round})`}</li>`),
      ...p.laterDeaths.map(d => `<li class="warn">${esc(d.name)} serait tué plus tard s'il ne bouge pas (manche ${d.round}, tour de ${esc(d.turnOf)})</li>`),
    ].join('')
    return `<article class="rv-plan${on ? ' on' : ''}${p.safe ? '' : ' unsafe'}" data-plan="${key}">
        <header><b>${title}</b> · <b>${fmt(p.total)}</b> dégâts · PA ${p.apUsed} · PM ${p.mpUsed} · fin en ${p.endCell}</header>
        <p class="dmg">${esc(p.damage.map(d => `${d.name} −${fmt(d.amount)}`).join(', ') || 'aucun dégât')}${p.killed.length ? ` · <b>tue ${esc(p.killed.join(', '))}</b>` : ''}</p>
        <ol class="steps">${steps}</ol>
        ${warn ? `<ul class="warns">${warn}</ul>` : ''}
        <div class="acts"><button class="btn" type="button" data-show="${key}">Voir sur la carte</button>${anim ? `<button class="btn" type="button" data-anim="${key}">Animer</button>` : ''}</div>
      </article>`
  }

  private renderPlans(): string {
    const r = this.result
    if (!r) return this.team ? '' : `<div class="rv-card"><h4>Meilleurs tours</h4><p>« Calculer les meilleurs tours » : le Crâ qui joue seul. « Meilleur round » : les 4 Crâs ensemble, monstres simulés.</p></div>`
    const stale = this.stale ? `<p class="rv-stale">Calculé pour un état modifié depuis : relancez le calcul.</p>` : ''
    const on = (list: string, i: number) => this.teamSel === null && this.planSel?.list === list && this.planSel.i === i
    return `<div class="rv-card rv-plans">
      <h4>Meilleurs tours sûrs <small>(${fmt(r.evaluated)} lancers évalués, ${(r.ms / 1000).toFixed(1)} s)</small></h4>
      ${stale}
      ${r.plans.length ? r.plans.map((p, i) => this.planCard(p, `plans:${i}`, `n°${i + 1}`, on('plans', i), true)).join('') : '<p class="bad">Aucun tour sûr trouvé.</p>'}
      ${r.unsafe.length ? `<h4>Pour comparaison : meilleurs tours non sûrs</h4>${r.unsafe.slice(0, 2).map((p, i) => this.planCard(p, `unsafe:${i}`, `non sûr n°${i + 1}`, on('unsafe', i), true)).join('')}` : ''}
    </div>`
  }

  /** Placement optimisé : case de chaque Crâ, ensembles de cases essayés, bouton pour charger le placement. */
  private renderPlacement(): string {
    const pl = this.placement
    if (!pl) return ''
    const v = this.view?.snapshot
    const applied = !!v && pl.team.placement.every(x => v.entities.find(e => e.gameId === x.gameId)?.cell === x.cell)
    const rows = pl.team.placement.map(x => `<li><b>${esc(x.name)}</b> → case <b>${x.cell}</b></li>`).join('')
    const sets = pl.sets
      .map(st => `<li>${st.cells.join(', ')} : ${fmt(st.damage)} dégâts${st.score < st.damage ? ` <span class="warn">(coups reçus)</span>` : ''}</li>`)
      .join('')
    return `<div class="rv-card rv-team">
      <h4>Placement optimisé <small>(${(pl.ms / 1000).toFixed(0)} s)</small></h4>
      <p class="rv-src">Pour les positions de monstres chargées ; la Reine joue la première. Sur la carte : dégâts du meilleur tour d'un Crâ seul sur chaque case rouge (contour or : cases retenues).</p>
      <ol class="steps">${rows}</ol>
      <p>${applied ? '<span class="good">Placement chargé.</span>' : '<button class="btn rv-primary" type="button" data-apply-place>Appliquer ce placement</button>'}</p>
      <details class="rv-flow"><summary>Ensembles de cases essayés</summary><ol>${sets}</ol></details>
    </div>`
  }

  /** Meilleur round de l'équipe : bilan, tour de chaque Crâ (dans l'état où il le joue), déroulé avec les monstres. */
  private renderTeam(): string {
    const t = this.team
    if (!t) return ''
    const sc = t.score
    const stale = this.stale ? `<p class="rv-stale">Calculé pour un état modifié depuis : relancez le calcul.</p>` : ''
    const bilan = [
      `<b>${fmt(sc.monsterDamage)}</b> dégâts aux monstres`,
      sc.kills.length ? `<b>tue ${esc(sc.kills.join(', '))}</b>` : '',
      sc.craDeaths.length ? `<span class="bad">Crâs morts : ${esc(sc.craDeaths.join(', '))}</span>` : '<span class="good">aucun Crâ mort</span>',
      sc.craHpLost ? `<span class="bad">${fmt(sc.craHpLost)} PV perdus</span>` : '<span class="good">aucun PV perdu</span>',
      sc.marked.length ? `<span class="bad">marqués par Mort en Sursis : ${esc(sc.marked.join(', '))}</span>` : '',
    ].filter(Boolean).join(' · ')
    const turns = t.turns
      .map((x, i) => {
        const title = `${esc(x.name)}${x.rank ? ` <small>(son ${x.rank + 1}e meilleur tour seul)</small>` : ''}`
        return x.plan ? this.planCard(x.plan, `team:${i}`, title, this.teamSel === i, false) : `<article class="rv-plan unsafe"><header><b>${title}</b> · aucun tour trouvé : passe</header></article>`
      })
      .join('')
    const cras = new Set(t.turns.map(x => x.name))
    const flow = t.summaries
      .map(s => `<li class="${cras.has(s.name) ? 'cra' : 'mon'}"><b>M${s.round} ${esc(s.name)}</b> ${esc(s.actions.join(' ; ') || '(rien)')} — fin ${s.endCell}${s.alive ? '' : ' <span class="bad">(mort)</span>'}</li>`)
      .join('')
    const alts = t.alternatives.length
      ? `<p class="rv-src">Autres suites gardées : ${t.alternatives.map(a => `${fmt(a.score.monsterDamage)} dégâts${a.score.craDeaths.length || a.score.marked.length ? ' (risquée)' : ''}`).join(' · ')}</p>`
      : ''
    return `<div class="rv-card rv-plans rv-team">
      <h4>Meilleur round de l'équipe <small>(${t.evaluated} suites jouées, ${(t.ms / 1000).toFixed(1)} s)</small></h4>
      ${stale}
      <p>${bilan}</p>
      <p><button class="btn rv-primary" type="button" data-team-anim>Animer le round complet (monstres compris)</button></p>
      ${turns}
      <details class="rv-flow"><summary>Déroulé complet, monstres compris</summary><ol>${flow}</ol></details>
      ${alts}
    </div>`
  }

  private onSideClick(e: MouseEvent): void {
    const t = e.target as HTMLElement
    const pick = (attr: string) => {
      const el = t.closest<HTMLElement>(`[${attr}]`)
      if (!el) return null
      const [list, i] = el.getAttribute(attr)!.split(':')
      return { list: list as 'plans' | 'unsafe' | 'team', i: Number(i) }
    }
    const del = t.closest<HTMLElement>('[data-del]')
    if (del) {
      const i = Number(del.dataset.del)
      void this.edit(s => ({ ...s, entities: s.entities.filter((_, k) => k !== i) }))
      return
    }
    const roundBtn = t.closest<HTMLElement>('[data-round]')
    if (roundBtn) {
      const r = Number(roundBtn.dataset.round)
      void this.run(`Simulation de la manche ${r}…`, async () => {
        const res = await reineApi.round(r)
        this.openReplay(res.replay, `Reine — manche ${r} : vos actions, monstres simulés`)
      })
      return
    }
    if (t.closest('[data-apply-place]')) {
      void this.applyPlacement()
      return
    }
    if (t.closest('[data-team-anim]') && this.team) {
      const team = this.team
      const title = `Reine — meilleur round de l'équipe (${fmt(team.score.monsterDamage)} dégâts)`
      this.openReplay(team.replay, title)
      return
    }
    const anim = pick('data-anim')
    if (anim && this.result && anim.list !== 'team') {
      const p = this.result[anim.list][anim.i]
      if (p) void this.animate(p, `${anim.list === 'plans' ? '' : 'non sûr '}n°${anim.i + 1}`)
      return
    }
    const show = pick('data-show') ?? pick('data-plan')
    if (show) {
      if (show.list === 'team') this.teamSel = show.i
      else {
        this.teamSel = null
        this.planSel = { list: show.list, i: show.i }
      }
      this.display()
      this.updateMarks()
      this.renderSide()
      this.info.innerHTML = this.cellInfo(-1, null)
      return
    }
    const ent = t.closest<HTMLElement>('[data-ent]')
    if (ent) {
      const i = Number(ent.dataset.ent)
      this.selected = this.selected === i ? null : i
      this.renderer.selected = this.selected
      this.updateMarks()
      this.renderSide()
      this.info.innerHTML = this.cellInfo(-1, null)
    }
  }
}
