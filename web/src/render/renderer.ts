/**
 * Rendu Canvas 2D de la scène : sol isométrique (mis en cache), trous et piliers, placements,
 * glyphes/pièges, combattants (jetons triés en profondeur) et couches d'animation.
 */
import { cellToPoint, pointToCell, CELL_COUNT } from '@/map/geometry'
import type { MapData } from '@/data/model'
import type { FighterView, ViewState } from '@/replay/types'
import type { Palette } from '../theme'
import { mix, withAlpha } from '../theme'
import { clamp01, tokenRadius, type Anim, type Pose, type RenderCtx } from './anims'
import {
  CELL_H,
  CELL_W,
  PILLAR_H,
  SLAB_H,
  Viewport,
  cellAtPoint,
  cellCenter,
  classifyCells,
  computeBounds,
  diamondPath,
  type CellKind,
  type Pt,
} from './view'

interface FighterVisual {
  hp: number
  ghost: number
  shield: number
}

export function initials(name: string): string {
  const words = name.split(/[\s'’-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const w = words[0] ?? '?'
  return w.length <= 4 ? w : w.slice(0, 3)
}

const INVULNERABLE_RE = /invuln/i

export class StageRenderer {
  readonly ctx: CanvasRenderingContext2D
  view: Viewport = new Viewport({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
  kinds: CellKind[] = []
  map: MapData | null = null
  anims: Anim[] = []
  hoverCell = -1
  hover: number | null = null
  selected: number | null = null
  showPlacement = false
  private floor: HTMLCanvasElement | null = null
  private pillars: number[] = []
  private vis = new Map<number, FighterVisual>()
  private poses = new Map<number, Pose>()
  private lastState: ViewState | null = null
  private settled = false
  /** Caméra : point visé courant, indication temporaire (lancer, vague) et déplacement manuel. */
  private cam: Pt | null = null
  private hint: { pt: Pt; until: number } | null = null
  private snapCam = true
  manualFocus: Pt | null = null

  constructor(
    readonly canvas: HTMLCanvasElement,
    public pal: Palette,
  ) {
    this.ctx = canvas.getContext('2d')!
  }

  setMap(map: MapData, extraCells: Iterable<number>): void {
    this.map = map
    this.kinds = classifyCells(map)
    this.pillars = []
    this.kinds.forEach((k, c) => k === 'pillar' && this.pillars.push(c))
    const zoom = this.view.zoom
    this.view = new Viewport(computeBounds(this.kinds, extraCells))
    this.view.zoom = zoom
    this.manualFocus = null
    this.hint = null
    this.snapCam = true
    this.floor = null
    this.anims = []
    this.vis.clear()
  }

  resize(availW: number, maxH: number, dpr: number, forcedH?: number): void {
    this.view.fit(availW, maxH, dpr, forcedH)
    const w = Math.max(1, Math.round(this.view.cssW * this.view.dpr))
    const h = Math.max(1, Math.round(this.view.cssH * this.view.dpr))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.canvas.style.height = `${this.view.cssH}px`
    this.floor = null
    this.settled = false
  }

  setZoom(zoom: number): void {
    this.view.zoom = Math.max(1, zoom)
    this.view.lookAt(this.cam?.x ?? 0, this.cam?.y ?? 0)
    this.manualFocus = null
    this.snapCam = true
    this.floor = null
    this.settled = false
  }

  /** Oriente temporairement la caméra vers un point (lancer de sort, arrivée d'une vague). */
  focus(pt: Pt, until: number): void {
    this.hint = { pt, until }
    this.settled = false
  }

  /** Recentre la caméra sur l'action (fin d'un déplacement manuel, saut dans la chronologie). */
  releaseCamera(snap = false): void {
    this.manualFocus = null
    if (snap) {
      this.hint = null
      this.snapCam = true
    }
    this.settled = false
  }

  get cameraCenter(): Pt {
    const v = this.view
    return { x: v.left + v.visW / 2, y: v.top + v.visH / 2 }
  }

  setPalette(pal: Palette): void {
    this.pal = pal
    this.floor = null
    this.settled = false
  }

  add(anim: Anim): void {
    this.anims.push(anim)
    this.settled = false
  }

  clearAnims(): void {
    this.anims = []
    this.settled = false
  }

  /** Recale les barres de vie sans transition (après un saut dans la chronologie). */
  snap(state: ViewState): void {
    this.vis.clear()
    for (const f of state.fighters) this.vis.set(f.id, { hp: f.hp, ghost: f.hp, shield: f.shield })
    this.settled = false
  }

  invalidate(): void {
    this.settled = false
  }

  /** Vrai s'il reste quelque chose à animer (sinon on peut sauter des images). */
  busy(now: number): boolean {
    return !this.settled || this.anims.some(a => now < a.t0 + a.dur + 50)
  }

  // ───────────────────────────── image ─────────────────────────────

  frame(state: ViewState, now: number, dt: number): void {
    this.lastState = state
    this.anims = this.anims.filter(a => now < a.t0 + a.dur)
    let moving = this.updateVisuals(state, dt)
    this.computePoses(state, now)
    moving = this.updateCamera(state, now, dt) || moving

    const { ctx, view } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!this.floor) this.floor = this.renderFloor()
    const kd = view.k * view.dpr
    ctx.drawImage(this.floor, (view.bounds.minX - view.left) * kd, (view.bounds.minY - view.top) * kd, view.width * kd, view.height * kd)
    ctx.setTransform(...view.matrix())

    this.drawOverlays(state, now)
    const r = this.renderCtx()
    for (const a of this.anims) if (a.layer === 'ground' && a.draw && now >= a.t0) a.draw(r, clamp01((now - a.t0) / a.dur))
    this.drawDepthSorted(state, now)
    for (const a of this.anims) if (a.layer === 'fx' && a.draw && now >= a.t0) a.draw(r, clamp01((now - a.t0) / a.dur))
    this.drawHuds(state, now)
    for (const a of this.anims) if (a.layer === 'text' && a.draw && now >= a.t0) a.draw(r, clamp01((now - a.t0) / a.dur))
    // Le marqueur du combattant actif pulse : on continue d'animer tant qu'un tour est en cours.
    this.settled = !moving && this.anims.length === 0 && !state.turnActive
  }

  private renderCtx(): RenderCtx {
    return {
      ctx: this.ctx,
      view: this.view,
      pal: this.pal,
      pose: id => this.poses.get(id),
      head: id => {
        const p = this.poses.get(id)
        const f = this.lastState?.fighters.find(x => x.id === id)
        if (!p || !f) return undefined
        const R = tokenRadius(f.kind, f.boss) * p.scale
        return { x: p.x, y: p.y - p.lift - (2 * R + 4) * p.squash - 10 }
      },
    }
  }

  /** Met à jour la caméra (zoom > 1) ; retourne vrai tant qu'elle se déplace. */
  private updateCamera(state: ViewState, now: number, dt: number): boolean {
    const v = this.view
    if (v.zoom <= 1.001) {
      v.lookAt(0, 0)
      return false
    }
    let target: Pt | null = this.manualFocus
    if (!target && this.hint && now < this.hint.until) target = this.hint.pt
    if (!target) {
      const id = state.current
      const pose = id !== null ? this.poses.get(id) : undefined
      if (pose) target = { x: pose.x, y: pose.y - 24 }
    }
    if (!target && this.poses.size) {
      // Pas de combattant actif (placement) : centre du rectangle englobant les combattants
      // (le centre de gravité penche vers l'équipe la plus nombreuse et coupe l'autre).
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const p of this.poses.values()) {
        x0 = Math.min(x0, p.x)
        x1 = Math.max(x1, p.x)
        y0 = Math.min(y0, p.y)
        y1 = Math.max(y1, p.y)
      }
      target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 24 }
    }
    if (!target) target = this.cam ?? { x: (v.bounds.minX + v.bounds.maxX) / 2, y: (v.bounds.minY + v.bounds.maxY) / 2 }
    if (!this.cam || this.snapCam || this.manualFocus) {
      this.cam = { ...target }
      this.snapCam = false
    } else {
      const k = 1 - Math.exp(-dt / 320)
      this.cam.x += (target.x - this.cam.x) * k
      this.cam.y += (target.y - this.cam.y) * k
    }
    v.lookAt(this.cam.x, this.cam.y)
    return Math.abs(target.x - this.cam.x) + Math.abs(target.y - this.cam.y) > 0.6
  }

  private updateVisuals(state: ViewState, dt: number): boolean {
    let moving = false
    const kHp = 1 - Math.exp(-dt / 110)
    const kGhost = 1 - Math.exp(-dt / 520)
    for (const f of state.fighters) {
      let v = this.vis.get(f.id)
      if (!v) {
        v = { hp: f.hp, ghost: f.hp, shield: f.shield }
        this.vis.set(f.id, v)
      }
      v.hp += (f.hp - v.hp) * kHp
      v.shield += (f.shield - v.shield) * kHp
      if (v.ghost < v.hp) v.ghost = v.hp
      else v.ghost += (v.hp - v.ghost) * kGhost
      if (Math.abs(v.hp - f.hp) < 0.5) v.hp = f.hp
      if (Math.abs(v.shield - f.shield) < 0.5) v.shield = f.shield
      if (Math.abs(v.ghost - v.hp) < 0.5) v.ghost = v.hp
      if (v.hp !== f.hp || v.ghost !== v.hp || v.shield !== f.shield) moving = true
    }
    return moving
  }

  private computePoses(state: ViewState, now: number): void {
    this.poses.clear()
    for (const f of state.fighters) {
      const mine = this.anims.filter(a => a.fighter === f.id)
      const keep = mine.some(a => a.keepVisible && now >= a.t0)
      if (!f.alive && !keep) continue
      if (f.cell < 0 || f.cell >= CELL_COUNT) continue
      const c = cellCenter(f.cell)
      const pose: Pose = { x: c.x, y: c.y, alpha: 1, scale: 1, squash: 1, lift: 0, flash: 0, flashColor: '#fff', shake: 0, tilt: 0 }
      for (const a of mine) {
        if (!a.pose) continue
        if (now < a.t0) {
          // Apparition programmée plus tard (vague échelonnée) : encore invisible.
          if (a.hiddenBefore) pose.alpha = 0
          continue
        }
        a.pose(pose, clamp01((now - a.t0) / a.dur))
      }
      this.poses.set(f.id, pose)
    }
  }

  // ───────────────────────────── sol (cache) ─────────────────────────────

  /** Sol de toute la carte, rendu une fois à la résolution courante (zoom compris). */
  private renderFloor(): HTMLCanvasElement {
    const v = this.view
    const kc = Math.min(v.k * v.dpr, 4096 / v.width, 4096 / v.height)
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.ceil(v.width * kc))
    cv.height = Math.max(1, Math.ceil(v.height * kc))
    const ctx = cv.getContext('2d')!
    ctx.setTransform(kc, 0, 0, kc, -v.bounds.minX * kc, -v.bounds.minY * kc)
    const pal = this.pal
    const solid = (c: number) => c >= 0 && (this.kinds[c] === 'floor' || this.kinds[c] === 'pillar')
    const hw = CELL_W / 2
    const hh = CELL_H / 2
    ctx.lineJoin = 'round'

    // Ombre portée douce de l'arène.
    ctx.save()
    ctx.shadowColor = pal.dark ? 'rgba(0,0,0,0.55)' : 'rgba(70,45,15,0.28)'
    ctx.shadowBlur = 26 * kc
    ctx.shadowOffsetY = 10 * kc
    ctx.beginPath()
    for (let c = 0; c < CELL_COUNT; c++) if (solid(c) || this.kinds[c] === 'hole') diamondPath(ctx, c, -0.5)
    ctx.fillStyle = pal.edge2
    ctx.fill()
    ctx.restore()

    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 14; col++) {
        const c = row * 14 + col
        const kind = this.kinds[c]
        if (kind === 'void') continue
        const { x, y } = cellCenter(c)
        const p = cellToPoint(c)
        if (kind === 'hole') {
          ctx.save()
          ctx.beginPath()
          diamondPath(ctx, c)
          ctx.fillStyle = pal.hole2
          ctx.fill()
          ctx.clip()
          const d = CELL_H * 0.55
          ctx.beginPath()
          ctx.moveTo(x - hw, y)
          ctx.lineTo(x, y - hh)
          ctx.lineTo(x + hw, y)
          ctx.lineTo(x + hw, y + d)
          ctx.lineTo(x, y - hh + d)
          ctx.lineTo(x - hw, y + d)
          ctx.closePath()
          ctx.fillStyle = pal.hole
          ctx.fill()
          ctx.restore()
          continue
        }
        // Sol (aussi sous les piliers).
        const parity = (p.x + p.y) & 1
        const noise = ((c * 2654435761) >>> 0) / 4294967296
        ctx.beginPath()
        diamondPath(ctx, c)
        ctx.fillStyle = parity ? pal.floorA : pal.floorB
        ctx.fill()
        ctx.fillStyle = noise > 0.5 ? `rgba(255,255,255,${(noise - 0.5) * 0.09})` : `rgba(0,0,0,${(0.5 - noise) * 0.06})`
        ctx.fill()
        ctx.strokeStyle = pal.grid
        ctx.lineWidth = v.dpr / kc
        ctx.stroke()
      }
      // Tranche de la dalle sous les bords de l'arène (faces bas-gauche / bas-droite).
      for (let col = 0; col < 14; col++) {
        const c = row * 14 + col
        if (!solid(c)) continue
        const { x, y } = cellCenter(c)
        const p = cellToPoint(c)
        const bl = pointToCell(p.x, p.y - 1)
        const br = pointToCell(p.x + 1, p.y)
        if (bl < 0 || this.kinds[bl] === 'void') {
          ctx.beginPath()
          ctx.moveTo(x - hw, y)
          ctx.lineTo(x, y + hh)
          ctx.lineTo(x, y + hh + SLAB_H)
          ctx.lineTo(x - hw, y + SLAB_H)
          ctx.closePath()
          ctx.fillStyle = pal.edge
          ctx.fill()
        }
        if (br < 0 || this.kinds[br] === 'void') {
          ctx.beginPath()
          ctx.moveTo(x, y + hh)
          ctx.lineTo(x + hw, y)
          ctx.lineTo(x + hw, y + SLAB_H)
          ctx.lineTo(x, y + hh + SLAB_H)
          ctx.closePath()
          ctx.fillStyle = pal.edge2
          ctx.fill()
        }
      }
    }
    return cv
  }

  // ───────────────────────────── calques ─────────────────────────────

  private drawOverlays(state: ViewState, now: number): void {
    const { ctx, pal, view } = this
    if (this.showPlacement && this.map) {
      for (const team of [1, 2] as const) {
        ctx.beginPath()
        for (const cell of this.map.cells) if (cell.placement === team && this.kinds[cell.id] === 'floor') diamondPath(ctx, cell.id, 2)
        const col = team === 1 ? pal.placement0 : pal.placement1
        ctx.fillStyle = col
        ctx.fill()
        ctx.strokeStyle = withAlpha(team === 1 ? pal.team0 : pal.team1, 0.75)
        ctx.lineWidth = view.px(1.5)
        ctx.stroke()
      }
    }
    const shimmer = 0.5 + 0.5 * Math.sin(now / 520)
    for (const g of state.glyphs) {
      ctx.beginPath()
      for (const c of g.cells) diamondPath(ctx, c, 1.5)
      ctx.fillStyle = withAlpha(g.color, 0.22 + 0.1 * shimmer)
      ctx.fill()
      ctx.strokeStyle = withAlpha(g.color, 0.9)
      ctx.lineWidth = view.px(1.6)
      ctx.stroke()
      // Motif central de la glyphe.
      const c = cellCenter(g.cells[Math.floor(g.cells.length / 2)] ?? g.cells[0])
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, 11, 5.5, 0, 0, Math.PI * 2)
      ctx.strokeStyle = withAlpha(g.color, 0.75)
      ctx.lineWidth = view.px(1.2)
      ctx.stroke()
    }
    for (const t of state.traps) {
      ctx.save()
      ctx.setLineDash([view.px(4), view.px(3)])
      ctx.beginPath()
      for (const c of t.cells) diamondPath(ctx, c, 3)
      ctx.fillStyle = withAlpha(t.color, 0.12)
      ctx.fill()
      ctx.strokeStyle = withAlpha(t.color, 0.95)
      ctx.lineWidth = view.px(1.6)
      ctx.stroke()
      ctx.restore()
    }
    // Cellule du combattant actif.
    const cur = state.current !== null && state.turnActive ? state.fighters.find(f => f.id === state.current && f.alive) : undefined
    if (cur) {
      const pose = this.poses.get(cur.id)
      const pulse = 0.5 + 0.5 * Math.sin(now / 260)
      ctx.save()
      if (pose) ctx.translate(pose.x - cellCenter(cur.cell).x, pose.y - cellCenter(cur.cell).y)
      ctx.beginPath()
      diamondPath(ctx, cur.cell, 1)
      ctx.fillStyle = withAlpha(pal.gold, 0.16 + 0.14 * pulse)
      ctx.fill()
      ctx.strokeStyle = withAlpha(pal.gold, 0.95)
      ctx.lineWidth = view.px(2.2)
      ctx.stroke()
      ctx.restore()
    }
    const sel = this.selected !== null ? state.fighters.find(f => f.id === this.selected && f.alive) : undefined
    if (sel) {
      ctx.beginPath()
      diamondPath(ctx, sel.cell, 3)
      ctx.strokeStyle = pal.focus
      ctx.lineWidth = view.px(2)
      ctx.stroke()
    }
    if (this.hoverCell >= 0 && this.kinds[this.hoverCell] === 'floor') {
      ctx.beginPath()
      diamondPath(ctx, this.hoverCell, 1)
      ctx.fillStyle = pal.dark ? 'rgba(255,240,215,0.10)' : 'rgba(255,255,255,0.35)'
      ctx.fill()
    }
  }

  private drawDepthSorted(state: ViewState, now: number): void {
    type Item = { y: number; order: number; draw: () => void }
    const items: Item[] = []
    for (const c of this.pillars) items.push({ y: cellCenter(c).y, order: 0, draw: () => this.drawPillar(c) })
    for (const f of state.fighters) {
      const pose = this.poses.get(f.id)
      if (!pose) continue
      items.push({ y: pose.y, order: 1, draw: () => this.drawBody(f, pose, now) })
    }
    items.sort((a, b) => a.y - b.y || a.order - b.order)
    for (const it of items) it.draw()
  }

  private drawPillar(c: number): void {
    const { ctx, pal } = this
    const { x, y } = cellCenter(c)
    const hw = CELL_W / 2
    const hh = CELL_H / 2
    const h = PILLAR_H
    ctx.beginPath()
    ctx.moveTo(x - hw, y)
    ctx.lineTo(x, y + hh)
    ctx.lineTo(x, y + hh - h)
    ctx.lineTo(x - hw, y - h)
    ctx.closePath()
    ctx.fillStyle = pal.pillarLeft
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, y + hh)
    ctx.lineTo(x + hw, y)
    ctx.lineTo(x + hw, y - h)
    ctx.lineTo(x, y + hh - h)
    ctx.closePath()
    ctx.fillStyle = pal.pillarRight
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, y - hh - h)
    ctx.lineTo(x + hw, y - h)
    ctx.lineTo(x, y + hh - h)
    ctx.lineTo(x - hw, y - h)
    ctx.closePath()
    ctx.fillStyle = pal.pillarTop
    ctx.fill()
    ctx.strokeStyle = pal.dark ? 'rgba(255,240,220,0.12)' : 'rgba(255,255,255,0.45)'
    ctx.lineWidth = this.view.px(1)
    ctx.stroke()
    // Gravure : losange intérieur.
    ctx.beginPath()
    ctx.moveTo(x, y - hh - h + 6)
    ctx.lineTo(x + hw - 12, y - h)
    ctx.lineTo(x, y + hh - h - 6)
    ctx.lineTo(x - hw + 12, y - h)
    ctx.closePath()
    ctx.strokeStyle = pal.dark ? 'rgba(0,0,0,0.25)' : 'rgba(80,60,35,0.22)'
    ctx.stroke()
  }

  private teamColors(f: FighterView): [string, string] {
    return f.team === 0 ? [this.pal.team0, this.pal.team0b] : [this.pal.team1, this.pal.team1b]
  }

  private drawBody(f: FighterView, pose: Pose, now: number): void {
    const { ctx, pal, view } = this
    const R = tokenRadius(f.kind, f.boss) * pose.scale
    if (R <= 0.2 || pose.alpha <= 0.01) return
    const [main, light] = this.teamColors(f)
    const isCur = this.lastState?.current === f.id && this.lastState.turnActive && f.alive
    ctx.save()
    ctx.globalAlpha = pose.alpha
    // Socle au sol.
    ctx.beginPath()
    ctx.ellipse(pose.x, pose.y, R * 1.2, R * 0.58, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.fill()
    ctx.lineWidth = view.px(isCur ? 2.4 : 1.8)
    ctx.strokeStyle = isCur ? pal.gold : withAlpha(main, 0.9)
    ctx.stroke()

    ctx.translate(pose.x + pose.shake, pose.y - pose.lift)
    ctx.rotate(pose.tilt)
    ctx.scale(1, pose.squash)
    const cy = -(R + 4)
    const g = ctx.createRadialGradient(-R * 0.35, cy - R * 0.45, R * 0.1, 0, cy, R)
    g.addColorStop(0, mix(light, '#ffffff', 0.28))
    g.addColorStop(0.55, light)
    g.addColorStop(1, main)
    ctx.beginPath()
    ctx.arc(0, cy, R, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = f.boss ? 3.2 : 2.2
    ctx.strokeStyle = f.boss ? pal.boss : 'rgba(255,255,255,0.9)'
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, cy, R + (f.boss ? 1.6 : 1.1), 0, Math.PI * 2)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.stroke()
    // Reflet.
    ctx.beginPath()
    ctx.ellipse(-R * 0.25, cy - R * 0.52, R * 0.45, R * 0.2, -0.4, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fill()
    // Initiales.
    const label = initials(f.name)
    ctx.fillStyle = pal.tokenInk
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${R * (label.length > 3 ? 0.62 : 0.74)}px ${pal.font}`
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 2 * view.k * view.dpr
    ctx.fillText(label, 0, cy + R * 0.06)
    ctx.shadowBlur = 0
    if (pose.flash > 0.01) {
      ctx.beginPath()
      ctx.arc(0, cy, R + 1, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(pose.flashColor, 0.75 * pose.flash)
      ctx.fill()
    }
    ctx.restore()
    void now
  }

  /** Barres de vie, bouclier, badges d'états, marqueur du tour et étiquettes (toujours au-dessus). */
  private drawHuds(state: ViewState, now: number): void {
    const { ctx, pal, view } = this
    const list = state.fighters.filter(f => this.poses.has(f.id)).sort((a, b) => this.poses.get(a.id)!.y - this.poses.get(b.id)!.y)
    for (const f of list) {
      const pose = this.poses.get(f.id)!
      if (pose.alpha <= 0.05) continue
      const v = this.vis.get(f.id) ?? { hp: f.hp, ghost: f.hp, shield: f.shield }
      const R = tokenRadius(f.kind, f.boss) * pose.scale
      const top = pose.y - pose.lift - (2 * R + 4) * pose.squash
      const bw = f.boss ? 50 : f.kind === 'summon' ? 30 : 42
      const bh = Math.max(4.5, view.px(4.5))
      const bx = pose.x - bw / 2
      const by = top - bh - Math.max(4, view.px(4))
      ctx.save()
      ctx.globalAlpha = pose.alpha
      const base = Math.max(1, f.baseMaxHp)
      ctx.fillStyle = pal.hpBack
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2)
      const erosionW = (bw * Math.max(0, f.baseMaxHp - f.maxHp)) / base
      if (erosionW > 0.3) {
        ctx.fillStyle = pal.erosion
        ctx.fillRect(bx + bw - erosionW, by, erosionW, bh)
      }
      const ghostW = (bw * Math.max(0, v.ghost)) / base
      ctx.fillStyle = 'rgba(255,240,220,0.85)'
      ctx.fillRect(bx, by, ghostW, bh)
      const frac = v.hp / Math.max(1, f.maxHp)
      ctx.fillStyle = frac > 0.5 ? pal.hpHigh : frac > 0.25 ? pal.hpMid : pal.hpLow
      ctx.fillRect(bx, by, (bw * Math.max(0, v.hp)) / base, bh)
      if (v.shield > 0.5) {
        const sw = Math.min(bw, (bw * v.shield) / Math.max(1, f.maxHp))
        const sh = Math.max(2.5, bh * 0.6)
        ctx.fillStyle = pal.hpBack
        ctx.fillRect(bx - 1, by - sh - 2, sw + 2, sh + 1)
        ctx.fillStyle = pal.shield
        ctx.fillRect(bx, by - sh - 1, sw, sh - 0.5)
      }
      // Couronne du boss.
      let iconX = bx + bw + 3
      if (f.boss) {
        const cx = bx - 8
        const cy = by + bh / 2
        ctx.beginPath()
        ctx.moveTo(cx - 6, cy + 4)
        ctx.lineTo(cx - 6, cy - 3)
        ctx.lineTo(cx - 3, cy)
        ctx.lineTo(cx, cy - 5)
        ctx.lineTo(cx + 3, cy)
        ctx.lineTo(cx + 6, cy - 3)
        ctx.lineTo(cx + 6, cy + 4)
        ctx.closePath()
        ctx.fillStyle = pal.boss
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // États : bouclier doré pour l'invulnérabilité, pastilles pour les autres.
      for (const s of f.states.slice(0, 3)) {
        const cy = by + bh / 2
        if (INVULNERABLE_RE.test(s.name)) {
          ctx.beginPath()
          ctx.moveTo(iconX + 5, cy - 7)
          ctx.lineTo(iconX + 10, cy - 5)
          ctx.quadraticCurveTo(iconX + 10, cy + 3, iconX + 5, cy + 7)
          ctx.quadraticCurveTo(iconX, cy + 3, iconX, cy - 5)
          ctx.closePath()
          ctx.fillStyle = pal.gold
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'
          ctx.lineWidth = 1
          ctx.stroke()
          iconX += 12
        } else {
          ctx.beginPath()
          ctx.arc(iconX + 4, cy, 4, 0, Math.PI * 2)
          ctx.fillStyle = pal.state
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,0,0,0.45)'
          ctx.lineWidth = 1
          ctx.stroke()
          iconX += 10
        }
      }
      // Numéro de vague (gardiens des vagues suivantes).
      if (f.wave && f.wave > 1) {
        const x = pose.x + R * 0.85
        const y = pose.y - pose.lift - 6
        ctx.beginPath()
        ctx.arc(x, y, 6.5, 0, Math.PI * 2)
        ctx.fillStyle = '#7c4bd0'
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = `800 8.5px ${pal.font}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(f.wave), x, y + 0.5)
      }
      // Marqueur du combattant actif.
      if (state.current === f.id && state.turnActive && f.alive) {
        const bob = Math.sin(now / 200) * 2.5
        const ty = by - (v.shield > 0.5 ? 9 : 5) - 9 + bob
        ctx.beginPath()
        ctx.moveTo(pose.x - 7, ty - 6)
        ctx.lineTo(pose.x + 7, ty - 6)
        ctx.lineTo(pose.x, ty + 2)
        ctx.closePath()
        ctx.fillStyle = pal.gold
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // Nom (survol, sélection).
      if ((this.hover === f.id || this.selected === f.id) && f.alive) {
        const fs = view.px(11.5)
        ctx.font = `700 ${fs}px ${pal.font}`
        const tw = ctx.measureText(f.name).width + view.px(12)
        const th = view.px(18)
        const lx = pose.x - tw / 2
        const ly = pose.y + R * 0.6 + view.px(3)
        ctx.fillStyle = pal.labelBg
        ctx.beginPath()
        ctx.roundRect(lx, ly, tw, th, th / 2)
        ctx.fill()
        ctx.fillStyle = pal.labelInk
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(f.name, pose.x, ly + th / 2 + view.px(0.5))
      }
      ctx.restore()
    }
  }

  // ───────────────────────────── interaction ─────────────────────────────

  /** Combattant sous un point (pixels CSS du canvas), sinon la cellule. */
  pick(cssX: number, cssY: number): { fighter: number | null; cell: number } {
    const p = this.view.toMap(cssX, cssY)
    const state = this.lastState
    let best: number | null = null
    let bestY = -Infinity
    if (state) {
      for (const f of state.fighters) {
        const pose = this.poses.get(f.id)
        if (!pose || !f.alive) continue
        const R = tokenRadius(f.kind, f.boss) * pose.scale
        const cy = pose.y - pose.lift - (R + 4)
        const hit = Math.hypot(p.x - pose.x, p.y - cy) <= R + 4 || (Math.abs(p.x - pose.x) <= R * 1.2 && Math.abs(p.y - pose.y) <= R * 0.6)
        if (hit && pose.y > bestY) ((best = f.id), (bestY = pose.y))
      }
    }
    const cell = cellAtPoint(p)
    if (best === null && cell >= 0 && state) {
      const f = state.fighters.find(x => x.alive && x.cell === cell)
      if (f) best = f.id
    }
    return { fighter: best, cell }
  }

  center(cell: number): Pt {
    return cellCenter(cell)
  }
}
