/**
 * Application du visualiseur : relie le lecteur (horloge), le metteur en scène (animations),
 * le rendu Canvas et les panneaux DOM.
 */
import { ReplayTimeline, getFighter } from '@/replay/reducer'
import type { FighterView, Replay, ViewState } from '@/replay/types'
import { defaultMap } from '@/replay/validate'
import { formatInt } from '@/replay/log'
import { Player, SPEEDS } from './player'
import { Director } from './render/director'
import { StageRenderer } from './render/renderer'
import { readPalette } from './theme'
import { ICONS, ZOOM_ICONS } from './ui/icons'
import { CELL_W } from './render/view'
import { LogPanel, TurnOrderPanel, esc, renderDetails, renderMarkers, renderResult } from './ui/panels'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

/**
 * (Re)lance l'animation CSS d'une bannière sans forcer de mise en page synchrone
 * (`offsetWidth`), coûteuse quand la page contient beaucoup d'éléments.
 */
function replay(el: HTMLElement, cls: string): void {
  const showing = el.classList.contains('show')
  el.className = `${cls} show`
  if (showing && typeof el.getAnimations === 'function') {
    for (const a of el.getAnimations()) {
      a.cancel()
      a.play()
    }
  }
}

export class ViewerApp {
  readonly stage = $('stage')
  readonly canvas = $<HTMLCanvasElement>('map-canvas')
  readonly renderer: StageRenderer
  readonly director: Director
  private player: Player | null = null
  private tl: ReplayTimeline | null = null
  private replay: Replay | null = null
  private selected: number | null = null
  private uiDirty = true
  private lastFrame = 0
  private resultDismissed = false
  private readonly turnOrder: TurnOrderPanel
  private readonly log: LogPanel
  private readonly scrub = $<HTMLInputElement>('scrub')
  /** Zoom choisi par l'utilisateur (null = automatique selon la taille d'écran). */
  private zoomChoice: 'overview' | 'follow' | null = null
  private drag: { x: number; y: number; cam: { x: number; y: number }; moved: boolean } | null = null
  private suppressClick = false

  constructor() {
    this.renderer = new StageRenderer(this.canvas, readPalette())
    this.director = new Director(this.renderer, {
      turnBanner: (f, ap, mp) => this.turnBanner(f, ap, mp),
      bigBanner: (text, kind) => this.bigBanner(text, kind),
      infoStrip: (text, level) => this.infoStrip(text, level),
    })
    this.turnOrder = new TurnOrderPanel($('turn-order'), id => this.select(id))
    this.log = new LogPanel($<HTMLOListElement>('log'), i => this.player?.seek(i))
    this.bindControls()
    this.bindCanvas()
    this.bindKeyboard()
    new ResizeObserver(() => this.fit()).observe(this.stage)
    window.addEventListener('resize', () => this.fit())
    this.watchPixelRatio()
    requestAnimationFrame(t => this.loop(t))
  }

  // ───────────────────────────── chargement ─────────────────────────────

  load(replay: Replay): void {
    this.replay = replay
    const tl = new ReplayTimeline(replay)
    this.tl = tl
    this.selected = null
    this.resultDismissed = false
    const map = replay.map ?? defaultMap(tl.stateAt(0).mapId)
    this.renderer.setMap(map, tl.visitedCells)
    this.renderer.selected = null
    this.director.reset()
    const clock = this.player?.clock ?? 0
    this.player = new Player(tl, {
      apply: (i, prev, next, t0) => this.director.apply(tl.events, i, prev, next, t0),
      seek: state => {
        this.renderer.clearAnims()
        this.renderer.snap(state)
        this.renderer.releaseCamera(true)
        for (const id of ['turn-banner', 'big-banner', 'info-strip']) $(id).classList.remove('show')
        this.director.reset()
        this.resultDismissed = false
      },
      change: () => {
        this.uiDirty = true
        this.renderer.invalidate()
      },
    })
    this.player.clock = clock
    this.renderer.snap(this.player.state)
    this.director.intro(this.player.state, clock)

    // En-tête
    const meta = replay.meta ?? {}
    $('replay-title').textContent = meta.title ?? 'Replay de combat'
    $('replay-desc').textContent = meta.description ?? ''
    document.title = `${meta.title ?? 'Combat'} · DofusSimu`
    $('team-summary').innerHTML = (meta.team ?? [])
      .map(m => `<li><span class="dot">${esc(m.name.slice(0, 3))}</span><b>${esc(m.name)}</b>${m.role ? ` ${esc(m.role)}` : ''}</li>`)
      .join('')
    $('fh-more').hidden = !meta.description && !(meta.team ?? []).length
    $('fight-head').classList.remove('expanded')
    $('fh-more').setAttribute('aria-expanded', 'false')
    $('fh-more').textContent = 'Détails'

    this.scrub.max = String(tl.length - 1)
    renderMarkers($('scrub-markers'), tl)
    this.turnOrder.reset()
    this.log.load(tl.log)
    $('result').hidden = true
    this.fit()
    this.uiDirty = true
  }

  getPlayer(): Player | null {
    return this.player
  }

  getTimeline(): ReplayTimeline | null {
    return this.tl
  }

  selectFighter(id: number | null): void {
    this.selected = null
    if (id !== null) this.select(id)
    else this.select(null)
  }

  // ───────────────────────────── boucle ─────────────────────────────

  private loop(t: number): void {
    const dtReal = this.lastFrame ? Math.min(100, t - this.lastFrame) : 16
    this.lastFrame = t
    const p = this.player
    if (p) {
      p.tick(dtReal)
      const dt = dtReal * p.speed
      this.renderer.showPlacement = p.state.round === 0 && !p.state.ended
      if (this.renderer.busy(p.clock) || p.playing) this.renderer.frame(p.state, p.clock, dt)
      if (this.uiDirty) {
        this.uiDirty = false
        this.updateUi()
      }
    }
    requestAnimationFrame(tt => this.loop(tt))
  }

  /** Ajuste le canvas : sur grand écran, carte + ordre de jeu + contrôles tiennent dans la fenêtre. */
  private markersWidth = 0

  private fit(): void {
    const w = this.stage.clientWidth
    if (!w) return
    const mw = $('scrub-markers').clientWidth
    if (this.tl && mw && mw !== this.markersWidth) {
      this.markersWidth = mw
      renderMarkers($('scrub-markers'), this.tl)
    }
    const wide = window.innerWidth > 900
    const stageTop = this.stage.getBoundingClientRect().top + window.scrollY
    const below = ($('turn-order').offsetHeight || 70) + ($('controls').offsetHeight || 100) + 2 * 12 + 16
    const maxH = wide ? Math.max(340, window.innerHeight - stageTop - below) : Math.max(260, window.innerHeight * 0.62)
    const dpr = window.devicePixelRatio || 1
    this.renderer.resize(w, maxH, dpr)
    // Zoom de suivi : automatique quand les cases sont trop petites (téléphone), sinon vue d'ensemble.
    const v = this.renderer.view
    const cellPx = v.scale * CELL_W
    const follow = this.zoomChoice ? this.zoomChoice === 'follow' : cellPx < (wide ? 30 : 40)
    const zoom = follow ? Math.max(1.5, Math.min(2.2, 44 / cellPx)) : 1
    // En mode suivi sur écran étroit, une scène plus haute montre plus de terrain autour de l'action.
    if (follow && !wide) this.renderer.resize(w, maxH, dpr, Math.round(Math.min(w * 0.95, window.innerHeight * 0.6)))
    if (Math.abs(v.zoom - zoom) > 0.01) this.renderer.setZoom(zoom)
    this.renderer.invalidate()
    this.stage.classList.toggle('zoomed', follow)
    const btn = $('zoom-btn')
    btn.innerHTML = follow ? `${ZOOM_ICONS.overview}<span>Vue d’ensemble</span>` : `${ZOOM_ICONS.follow}<span>Suivre l’action</span>`
    btn.title = follow ? 'Afficher toute la carte' : 'Zoomer et suivre le combattant actif'
  }

  /** Fenêtre déplacée vers un écran de densité différente (ou zoom du navigateur) : re-rendu net. */
  private watchPixelRatio(): void {
    if (!window.matchMedia) return
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener?.(
      'change',
      () => {
        this.fit()
        this.watchPixelRatio()
      },
      { once: true },
    )
  }

  refreshTheme(): void {
    this.renderer.setPalette(readPalette())
  }

  // ───────────────────────────── interface ─────────────────────────────

  private select(id: number | null): void {
    this.selected = this.selected === id ? null : id
    this.renderer.selected = this.selected
    this.renderer.invalidate()
    this.uiDirty = true
  }

  private updateUi(): void {
    const p = this.player
    const tl = this.tl
    if (!p || !tl || !this.replay) return
    const s = p.state
    // Lecture
    const playBtn = $('btn-play')
    playBtn.innerHTML = p.playing ? ICONS.pause : p.atEnd ? ICONS.replay : ICONS.play
    playBtn.setAttribute('aria-label', p.playing ? 'Pause' : p.atEnd ? 'Revoir' : 'Lecture')
    this.scrub.value = String(p.index)
    $('scrub-fill').style.width = `calc(8px + (100% - 16px) * ${p.index / Math.max(1, tl.length - 1)})`
    ;($('btn-prev') as HTMLButtonElement).disabled = p.index <= 0
    ;($('btn-start') as HTMLButtonElement).disabled = p.index <= 0
    ;($('btn-prev-turn') as HTMLButtonElement).disabled = p.index <= 0
    ;($('btn-next') as HTMLButtonElement).disabled = p.atEnd
    ;($('btn-end') as HTMLButtonElement).disabled = p.atEnd
    ;($('btn-next-turn') as HTMLButtonElement).disabled = p.atEnd
    for (const b of $('speed').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === p.speed))
    this.setSpeedVar()
    $('position').innerHTML = `Événement <b>${p.index + 1}</b> / ${tl.length}${s.round ? ` · tour <b>${s.round}</b>` : ''}`
    // Puces de la scène
    $('round-chip').textContent = s.ended ? 'Combat terminé' : s.round ? `Tour ${s.round}` : 'Placement'
    const wave = $('wave-chip')
    wave.hidden = !s.wave
    if (s.wave) wave.textContent = `Vague ${s.wave.index}/${s.wave.total}`
    // Panneaux
    // Comme dans Dofus, les morts quittent l'ordre de jeu au tour suivant.
    let roundStart = 0
    for (const r of tl.roundStarts) if (r.index <= p.index) roundStart = r.index
    const order = tl.turnOrder(s).filter(id => {
      const f = getFighter(s, id)
      return !!f && (f.alive || (f.diedAt ?? 0) >= roundStart || this.selected === id)
    })
    this.turnOrder.update(order, s, this.selected)
    const follow = this.selected === null
    const shown = getFighter(s, this.selected ?? s.current ?? undefined)
    renderDetails($('details'), shown, s, tl, this.replay, follow && !!shown)
    this.log.update(tl.logCount(p.index), p.index)
    // Résultat
    const result = $('result')
    if (s.ended && p.atEnd && !this.resultDismissed) {
      if (result.hidden)
        renderResult(
          result,
          s,
          () => {
            result.hidden = true
            p.seek(0)
            p.play()
          },
          () => {
            this.resultDismissed = true
            result.hidden = true
          },
        )
    } else result.hidden = true
  }

  private turnBanner(f: FighterView, ap: number, mp: number): void {
    const el = $('turn-banner')
    el.innerHTML = `<span class="sw"></span><span>Au tour de <b>${esc(f.name)}</b></span><small>${ap} PA · ${mp} PM</small>`
    replay(el, `turn-banner team${f.team}`)
  }

  private bigBanner(text: string, kind: 'round' | 'wave'): void {
    const el = $('big-banner')
    el.innerHTML = `<span>${esc(text)}</span>`
    replay(el, `big-banner ${kind}`)
  }

  private infoStrip(text: string, level: 'info' | 'warn'): void {
    const el = $('info-strip')
    el.textContent = text
    replay(el, `info-strip ${level}`)
  }

  private setSpeedVar(): void {
    this.stage.style.setProperty('--speed', String(this.player?.speed ?? 1))
  }

  private bindControls(): void {
    const btn = (id: string, icon: string, fn: () => void) => {
      const b = $(id)
      b.innerHTML = icon
      b.addEventListener('click', fn)
    }
    btn('btn-play', ICONS.play, () => this.player?.toggle())
    btn('btn-next', ICONS.next, () => this.player?.stepForward())
    btn('btn-prev', ICONS.prev, () => this.player?.stepBack())
    btn('btn-next-turn', ICONS.nextTurn, () => this.player?.nextTurn())
    btn('btn-prev-turn', ICONS.prevTurn, () => this.player?.prevTurn())
    btn('btn-start', ICONS.start, () => this.player?.seek(0))
    btn('btn-end', ICONS.end, () => this.player?.seek(this.player.last))
    const speed = $('speed')
    speed.innerHTML = SPEEDS.map(s => `<button type="button" data-speed="${s}" aria-pressed="${s === 1}" title="Vitesse ×${String(s).replace('.', ',')}">${String(s).replace('.', ',')}×</button>`).join('')
    speed.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
      if (!b || !this.player) return
      this.player.setSpeed(Number(b.dataset.speed))
      this.setSpeedVar()
    })
    $('fh-more').addEventListener('click', () => {
      const head = $('fight-head')
      const open = head.classList.toggle('expanded')
      $('fh-more').setAttribute('aria-expanded', String(open))
      $('fh-more').textContent = open ? 'Réduire' : 'Détails'
      this.fit()
    })
    $('zoom-btn').addEventListener('click', () => {
      this.zoomChoice = this.stage.classList.contains('zoomed') ? 'overview' : 'follow'
      this.fit()
    })
    this.scrub.addEventListener('input', () => {
      if (!this.player) return
      this.player.pause()
      this.player.seek(Number(this.scrub.value))
    })
  }

  private bindCanvas(): void {
    const local = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    // Glisser pour déplacer la caméra quand la carte est zoomée.
    this.canvas.addEventListener('pointerdown', e => {
      if (this.renderer.view.zoom <= 1.001) return
      const { x, y } = local(e)
      this.drag = { x, y, cam: this.renderer.cameraCenter, moved: false }
    })
    const endDrag = () => {
      if (this.drag?.moved) this.suppressClick = true
      this.drag = null
      this.canvas.classList.remove('dragging')
    }
    this.canvas.addEventListener('pointerup', endDrag)
    this.canvas.addEventListener('pointercancel', () => {
      this.drag = null
      this.canvas.classList.remove('dragging')
    })
    this.canvas.addEventListener('pointermove', e => {
      const { x, y } = local(e)
      if (this.drag) {
        const dx = x - this.drag.x
        const dy = y - this.drag.y
        if (!this.drag.moved && Math.hypot(dx, dy) > 6) {
          this.drag.moved = true
          this.canvas.classList.add('dragging')
          try {
            this.canvas.setPointerCapture(e.pointerId)
          } catch {
            /* ignoré */
          }
        }
        if (this.drag.moved) {
          const k = this.renderer.view.k
          this.renderer.manualFocus = { x: this.drag.cam.x - dx / k, y: this.drag.cam.y - dy / k }
          this.renderer.invalidate()
          return
        }
      }
      if (e.pointerType !== 'mouse') return
      const hit = this.renderer.pick(x, y)
      if (hit.fighter !== this.renderer.hover || hit.cell !== this.renderer.hoverCell) {
        this.renderer.hover = hit.fighter
        this.renderer.hoverCell = hit.cell
        this.canvas.classList.toggle('pointer', hit.fighter !== null)
        this.canvas.title = hit.fighter !== null ? this.tooltip(hit.fighter) : hit.cell >= 0 ? `Cellule ${hit.cell}` : ''
        this.renderer.invalidate()
      }
    })
    this.canvas.addEventListener('pointerleave', () => {
      this.renderer.hover = null
      this.renderer.hoverCell = -1
      this.renderer.invalidate()
    })
    this.canvas.addEventListener('click', e => {
      if (this.suppressClick) {
        this.suppressClick = false
        return
      }
      const { x, y } = local(e as PointerEvent)
      const hit = this.renderer.pick(x, y)
      if (hit.fighter !== null) this.select(hit.fighter)
      else if (this.selected !== null) this.select(null)
    })
  }

  private tooltip(id: number): string {
    const f = this.player ? getFighter(this.player.state, id) : undefined
    if (!f) return ''
    return `${f.name} — ${formatInt(f.hp)} / ${formatInt(f.maxHp)} PV · ${f.ap} PA · ${f.mp} PM`
  }

  private bindKeyboard(): void {
    document.addEventListener('keydown', e => {
      const p = this.player
      if (!p || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'SELECT' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range')) return
      let handled = true
      switch (e.key) {
        case ' ':
        case 'k':
          p.toggle()
          break
        case 'ArrowRight':
          if (e.shiftKey) p.nextTurn()
          else p.stepForward()
          break
        case 'ArrowLeft':
          if (e.shiftKey) p.prevTurn()
          else p.stepBack()
          break
        case 'ArrowDown':
        case 'PageDown':
          p.nextTurn()
          break
        case 'ArrowUp':
        case 'PageUp':
          p.prevTurn()
          break
        case 'Home':
          p.seek(0)
          break
        case 'End':
          p.seek(p.last)
          break
        case '+':
        case '=': {
          const i = SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number])
          p.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)])
          this.setSpeedVar()
          break
        }
        case '-': {
          const i = SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number])
          p.setSpeed(SPEEDS[Math.max(0, i - 1)])
          this.setSpeedVar()
          break
        }
        case 'Escape':
          this.select(null)
          break
        default:
          handled = false
      }
      if (handled) e.preventDefault()
    })
  }

  /** État courant (lecture seule), pour l'automatisation et le débogage. */
  current(): ViewState | null {
    return this.player?.state ?? null
  }
}
