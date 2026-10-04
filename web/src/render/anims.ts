/**
 * Animations du visualiseur. Une animation vit sur l'horloge du replay (ms, multipliée par la
 * vitesse) : elle peut modifier la « pose » d'un combattant (position, opacité, échelle, flash)
 * et/ou dessiner un effet (projectile, zone, texte flottant...) sous ou au-dessus des jetons.
 */
import type { Palette } from '../theme'
import { withAlpha } from '../theme'
import { CELL_W, cellCenter, diamondPath, type Pt, type Viewport } from './view'

// ───────────────────────────── easing ─────────────────────────────

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
export const easeInCubic = (t: number) => t * t * t
export const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ───────────────────────────── types ─────────────────────────────

export interface Pose {
  /** Point d'ancrage au sol (unités carte). */
  x: number
  y: number
  alpha: number
  scale: number
  /** Écrasement vertical (chute). */
  squash: number
  /** Décalage vertical supplémentaire (saut). */
  lift: number
  /** Flash de coup reçu (0..1). */
  flash: number
  flashColor: string
  shake: number
  /** Inclinaison (radians) pour la chute. */
  tilt: number
}

export interface RenderCtx {
  ctx: CanvasRenderingContext2D
  view: Viewport
  pal: Palette
  /** Pose courante d'un combattant (après animations), si affiché. */
  pose(id: number): Pose | undefined
  /** Point au-dessus de la tête d'un combattant. */
  head(id: number): Pt | undefined
}

export type Layer = 'ground' | 'fx' | 'text'

export interface Anim {
  t0: number
  dur: number
  layer: Layer
  /** Combattant dont la pose est modifiée (déplacements, apparitions, mort...). */
  fighter?: number
  /** Garde le combattant visible même s'il est mort (animation de mort). */
  keepVisible?: boolean
  /** Combattant invisible tant que l'animation n'a pas commencé (apparitions échelonnées). */
  hiddenBefore?: boolean
  pose?(pose: Pose, p: number): void
  draw?(r: RenderCtx, p: number): void
}

export function tokenRadius(kind: string, boss: boolean): number {
  return boss ? 21 : kind === 'summon' ? 13 : 17.5
}

// ───────────────────────────── poses ─────────────────────────────

/** Déplacement case par case avec accélération/décélération globale et léger rebond. */
export function moveAnim(fighter: number, path: number[], t0: number, perCell: number): Anim {
  const pts = path.map(cellCenter)
  const segs = Math.max(1, pts.length - 1)
  return {
    t0,
    dur: perCell * segs,
    layer: 'ground',
    fighter,
    pose(pose, p) {
      const e = segs > 1 ? lerp(p, easeInOutSine(p), 0.55) : easeInOutSine(p)
      const f = e * segs
      const i = Math.min(segs - 1, Math.floor(f))
      const t = f - i
      const a = pts[i]
      const b = pts[Math.min(pts.length - 1, i + 1)]
      pose.x = lerp(a.x, b.x, t)
      pose.y = lerp(a.y, b.y, t)
      pose.lift += Math.abs(Math.sin(t * Math.PI)) * 4 * (p < 1 ? 1 : 0)
    },
  }
}

/** Glissade (poussée, attirance) avec choc éventuel en fin de course. */
export function slideAnim(fighter: number, from: number, to: number, t0: number, dur: number, collision: boolean): Anim {
  const a = cellCenter(from)
  const b = cellCenter(to)
  return {
    t0,
    dur: dur + (collision ? 160 : 0),
    layer: 'ground',
    fighter,
    pose(pose, p) {
      const total = dur + (collision ? 160 : 0)
      const ms = p * total
      const t = easeOutCubic(clamp01(ms / dur))
      pose.x = lerp(a.x, b.x, t)
      pose.y = lerp(a.y, b.y, t)
      if (collision && ms > dur) {
        const k = (ms - dur) / 160
        pose.shake = Math.sin(k * Math.PI * 6) * 3 * (1 - k)
        pose.flash = Math.max(pose.flash, 0.6 * (1 - k))
      }
    },
  }
}

/** Téléportation : disparition au départ, réapparition à l'arrivée. */
export function teleportAnim(fighter: number, from: number, to: number, t0: number, dur: number, color: string): Anim {
  const a = cellCenter(from)
  const b = cellCenter(to)
  return {
    t0,
    dur,
    layer: 'fx',
    fighter,
    pose(pose, p) {
      if (p < 0.45) {
        const k = p / 0.45
        pose.x = a.x
        pose.y = a.y
        pose.alpha *= 1 - k
        pose.scale *= 1 - 0.35 * k
        pose.lift += 10 * k
      } else {
        const k = (p - 0.45) / 0.55
        pose.alpha *= easeOutCubic(k)
        pose.scale *= 0.65 + 0.35 * easeOutBack(k)
        pose.lift += 10 * (1 - k)
      }
    },
    draw(r, p) {
      const { ctx } = r
      const beam = (pt: Pt, k: number) => {
        if (k <= 0) return
        const g = ctx.createLinearGradient(pt.x, pt.y - 70, pt.x, pt.y)
        g.addColorStop(0, withAlpha(color, 0))
        g.addColorStop(1, withAlpha(color, 0.55 * k))
        ctx.fillStyle = g
        ctx.fillRect(pt.x - 10, pt.y - 70, 20, 70)
        ctx.beginPath()
        ctx.ellipse(pt.x, pt.y, 22 * (1.2 - k * 0.2), 11 * (1.2 - k * 0.2), 0, 0, Math.PI * 2)
        ctx.strokeStyle = withAlpha(color, 0.8 * k)
        ctx.lineWidth = r.view.px(2)
        ctx.stroke()
      }
      beam(a, p < 0.6 ? Math.sin((p / 0.6) * Math.PI) : 0)
      beam(b, p > 0.35 ? Math.sin(((p - 0.35) / 0.65) * Math.PI) : 0)
    },
  }
}

/** Apparition (invocation, vague) : grossissement avec rebond et anneau. */
export function spawnAnim(fighter: number, cell: number, t0: number, dur: number, color: string): Anim {
  const c = cellCenter(cell)
  return {
    t0,
    dur,
    layer: 'ground',
    fighter,
    hiddenBefore: true,
    pose(pose, p) {
      const k = clamp01(p / 0.7)
      pose.scale *= Math.max(0.01, easeOutBack(k))
      pose.alpha *= clamp01(p / 0.25)
      pose.lift += (1 - easeOutCubic(k)) * 26
    },
    draw(r, p) {
      ringAt(r, c, p, color, 34, 3)
    },
  }
}

/** Mort : le jeton bascule, s'écrase et s'efface. */
export function deathAnim(fighter: number, t0: number, dur: number): Anim {
  return {
    t0,
    dur,
    layer: 'ground',
    fighter,
    keepVisible: true,
    pose(pose, p) {
      const k = easeInCubic(clamp01((p - 0.15) / 0.85))
      pose.flash = Math.max(pose.flash, p < 0.2 ? 1 - p / 0.2 : 0)
      pose.flashColor = '#ffffff'
      pose.tilt = 0.9 * easeOutCubic(clamp01(p / 0.6))
      pose.squash *= 1 - 0.65 * k
      pose.alpha *= 1 - k
    },
  }
}

/** Coup reçu : flash coloré et tremblement. */
export function hitAnim(fighter: number, t0: number, color: string, strong: boolean): Anim {
  const dur = strong ? 420 : 300
  return {
    t0,
    dur,
    layer: 'ground',
    fighter,
    pose(pose, p) {
      pose.flash = Math.max(pose.flash, (1 - p) * (strong ? 0.85 : 0.65))
      pose.flashColor = color
      pose.shake += Math.sin(p * Math.PI * (strong ? 8 : 6)) * (strong ? 4 : 2.5) * (1 - p)
    },
  }
}

/** Impulsion du lanceur au moment du lancer. */
export function castPulseAnim(fighter: number, t0: number, color: string): Anim {
  return {
    t0,
    dur: 520,
    layer: 'fx',
    fighter,
    pose(pose, p) {
      pose.scale *= 1 + 0.14 * Math.sin(clamp01(p / 0.5) * Math.PI)
      pose.lift += 5 * Math.sin(clamp01(p / 0.5) * Math.PI)
    },
    draw(r, p) {
      const h = r.pose(fighter)
      if (!h) return
      ringAt(r, { x: h.x, y: h.y }, p, color, 30, 2.5)
    },
  }
}

// ───────────────────────────── effets ─────────────────────────────

function ringAt(r: RenderCtx, c: Pt, p: number, color: string, maxR: number, width: number): void {
  const { ctx } = r
  const k = easeOutCubic(p)
  ctx.beginPath()
  ctx.ellipse(c.x, c.y, maxR * (0.3 + 0.7 * k), maxR * 0.5 * (0.3 + 0.7 * k), 0, 0, Math.PI * 2)
  ctx.strokeStyle = withAlpha(color, 0.85 * (1 - p))
  ctx.lineWidth = Math.max(r.view.px(1.5), width * (1 - p * 0.6))
  ctx.stroke()
}

export function ringAnim(at: Pt, t0: number, dur: number, color: string, maxR = 36, layer: Layer = 'ground'): Anim {
  return { t0, dur, layer, draw: (r, p) => ringAt(r, at, p, color, maxR, 3) }
}

/** Projectile en arc du lanceur vers la cellule ciblée, avec traînée. */
export function projectileAnim(caster: number, fallbackFrom: Pt, to: Pt, t0: number, dur: number, color: string): Anim {
  let from: Pt | null = null
  return {
    t0,
    dur,
    layer: 'fx',
    draw(r, p) {
      if (!from) {
        const h = r.head(caster)
        from = h ? { x: h.x, y: h.y + 8 } : fallbackFrom
      }
      const { ctx } = r
      const target = { x: to.x, y: to.y - 12 }
      const dist = Math.hypot(target.x - from.x, target.y - from.y)
      const arc = Math.min(70, 18 + dist * 0.22)
      const at = (t: number): Pt => ({
        x: lerp(from!.x, target.x, t),
        y: lerp(from!.y, target.y, t) - Math.sin(t * Math.PI) * arc,
      })
      const e = easeInOutSine(p)
      for (let i = 7; i >= 0; i--) {
        const t = e - i * 0.035
        if (t < 0) continue
        const q = at(t)
        const rad = (7 - i * 0.7) * (i === 0 ? 1 : 0.8)
        ctx.beginPath()
        ctx.arc(q.x, q.y, Math.max(1, rad), 0, Math.PI * 2)
        ctx.fillStyle = withAlpha(color, i === 0 ? 1 : 0.5 * (1 - i / 8))
        ctx.fill()
      }
      const q = at(e)
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 16)
      g.addColorStop(0, 'rgba(255,255,255,0.95)')
      g.addColorStop(0.3, withAlpha(color, 0.85))
      g.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(q.x, q.y, 16, 0, Math.PI * 2)
      ctx.fill()
    },
  }
}

/** Éclat des cellules d'une zone d'effet. */
export function zoneFlashAnim(cells: number[], center: number, t0: number, dur: number, color: string): Anim {
  const c = cellCenter(center)
  return {
    t0,
    dur,
    layer: 'ground',
    draw(r, p) {
      const { ctx } = r
      const a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85
      ctx.beginPath()
      for (const cell of cells) diamondPath(ctx, cell, 1)
      ctx.fillStyle = withAlpha(color, 0.5 * a)
      ctx.fill()
      ctx.strokeStyle = withAlpha(color, 0.9 * a)
      ctx.lineWidth = r.view.px(1.4)
      ctx.stroke()
      ringAt(r, c, clamp01(p * 1.4), color, CELL_W * 0.9, 3.5)
    },
  }
}

/** Apparition / disparition d'une glyphe ou d'un piège. */
export function overlayPulseAnim(cells: number[], t0: number, color: string, added: boolean): Anim {
  return {
    t0,
    dur: 600,
    layer: 'ground',
    draw(r, p) {
      const { ctx } = r
      const a = added ? Math.sin(p * Math.PI) : 1 - p
      ctx.beginPath()
      for (const cell of cells) diamondPath(ctx, cell, 1 + (added ? (1 - p) * 6 : p * 6))
      ctx.strokeStyle = withAlpha(color, 0.95 * a)
      ctx.lineWidth = r.view.px(2.2)
      ctx.stroke()
    },
  }
}

/** Petites étincelles montantes (soin, bouclier). */
export function sparkleAnim(fighter: number, t0: number, color: string, shape: 'plus' | 'hex'): Anim {
  const seeds = Array.from({ length: 6 }, (_, i) => ({ dx: Math.sin(i * 2.4 + fighter) * 16, dy: (i % 3) * 6, d: (i * 37) % 100 / 400 }))
  return {
    t0,
    dur: 900,
    layer: 'fx',
    draw(r, p) {
      const pose = r.pose(fighter)
      if (!pose) return
      const { ctx } = r
      if (shape === 'hex') {
        ctx.beginPath()
        const cy = pose.y - 22
        const rad = 24 + 6 * p
        for (let i = 0; i < 6; i++) {
          const ang = (Math.PI / 3) * i + Math.PI / 6
          const x = pose.x + Math.cos(ang) * rad
          const y = cy + Math.sin(ang) * rad
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = withAlpha(color, 0.9 * (1 - p))
        ctx.lineWidth = r.view.px(2.5)
        ctx.stroke()
        ctx.fillStyle = withAlpha(color, 0.16 * (1 - p))
        ctx.fill()
        return
      }
      for (const s of seeds) {
        const k = clamp01((p - s.d) / 0.75)
        if (k <= 0 || k >= 1) continue
        const x = pose.x + s.dx
        const y = pose.y - 8 - s.dy - k * 34
        const size = 3.5 * (1 - k * 0.5)
        ctx.strokeStyle = withAlpha(color, 1 - k)
        ctx.lineWidth = r.view.px(2)
        ctx.beginPath()
        ctx.moveTo(x - size, y)
        ctx.lineTo(x + size, y)
        ctx.moveTo(x, y - size)
        ctx.lineTo(x, y + size)
        ctx.stroke()
      }
    },
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number): void {
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

/** Nom du sort au-dessus du lanceur. */
export function spellLabelAnim(fighter: number, text: string, t0: number, color: string, crit: boolean): Anim {
  return {
    t0,
    dur: 1250,
    layer: 'text',
    draw(r, p) {
      const h = r.head(fighter)
      if (!h) return
      const { ctx, view } = r
      const a = p < 0.12 ? p / 0.12 : p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1
      const fs = view.px(12)
      ctx.font = `700 ${fs}px ${r.pal.font}`
      const label = crit ? `${text} · critique` : text
      const w = ctx.measureText(label).width + view.px(16)
      const hgt = view.px(20)
      const vis = view.visible()
      const cx = Math.max(vis.minX + w / 2 + view.px(4), Math.min(vis.maxX - w / 2 - view.px(4), h.x))
      const x = cx - w / 2
      const y = h.y - view.px(30) - (1 - easeOutCubic(clamp01(p / 0.2))) * view.px(6)
      ctx.save()
      ctx.globalAlpha *= a
      roundedRect(ctx, x, y, w, hgt, hgt / 2)
      ctx.fillStyle = r.pal.labelBg
      ctx.fill()
      ctx.strokeStyle = withAlpha(color, 0.95)
      ctx.lineWidth = view.px(1.5)
      ctx.stroke()
      ctx.fillStyle = crit ? r.pal.gold : r.pal.labelInk
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, cx, y + hgt / 2 + view.px(0.5))
      ctx.restore()
    },
  }
}

/** Bulle de pensée de l'IA au-dessus d'un combattant. */
export function bubbleAnim(fighter: number, text: string, t0: number, dur: number): Anim {
  return {
    t0,
    dur,
    layer: 'text',
    draw(r, p) {
      const h = r.head(fighter)
      if (!h) return
      const { ctx, view } = r
      const a = p < 0.08 ? p / 0.08 : p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1
      const fs = view.px(11.5)
      ctx.font = `italic 500 ${fs}px ${r.pal.font}`
      const maxW = view.px(220)
      const words = text.split(' ')
      const lines: string[] = []
      let cur = ''
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w
        if (ctx.measureText(t).width > maxW && cur) {
          lines.push(cur)
          cur = w
        } else cur = t
      }
      if (cur) lines.push(cur)
      const lh = view.px(15)
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + view.px(18)
      const hgt = lines.length * lh + view.px(10)
      const bounds = view.visible()
      let x = h.x - w / 2
      x = Math.max(bounds.minX + view.px(4), Math.min(bounds.maxX - w - view.px(4), x))
      // Juste au-dessus du marqueur de tour, pour qu'on voie bien à qui appartient la bulle.
      let y = h.y - view.px(30) - hgt
      y = Math.max(bounds.minY + view.px(4), y)
      ctx.save()
      ctx.globalAlpha *= a
      roundedRect(ctx, x, y, w, hgt, view.px(8))
      ctx.fillStyle = r.pal.dark ? 'rgba(40,32,24,0.95)' : 'rgba(255,250,240,0.96)'
      ctx.fill()
      ctx.strokeStyle = r.pal.accent
      ctx.lineWidth = view.px(1.2)
      ctx.stroke()
      // petite queue (bulles de pensée) qui descend vers le combattant
      const tx = Math.max(x + view.px(10), Math.min(x + w - view.px(10), h.x))
      const gap = Math.max(view.px(8), h.y - (y + hgt))
      ctx.beginPath()
      ctx.arc(lerp(tx, h.x, 0.35), y + hgt + gap * 0.3, view.px(3), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(lerp(tx, h.x, 0.7), y + hgt + gap * 0.65, view.px(1.9), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = r.pal.dark ? '#f2e9da' : '#3a2c1c'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      lines.forEach((l, i) => ctx.fillText(l, x + view.px(9), y + view.px(5) + i * lh))
      ctx.restore()
    },
  }
}

export interface FloatStyle {
  color: string
  size: number
  weight?: number
  italic?: boolean
  /** Petit texte au-dessus (ex. « critique ! »). */
  sub?: { text: string; color: string }
  /** Pastille de couleur (élément) avant le texte. */
  dot?: string
}

/** Texte flottant (dégâts, soins, PA/PM, états) qui monte et s'efface. */
export function floatTextAnim(fighter: number, text: string, style: FloatStyle, t0: number, slot: number, dur = 1500, slotPx = 19): Anim {
  return {
    t0,
    dur,
    layer: 'text',
    draw(r, p) {
      const h = r.head(fighter)
      if (!h) return
      const { ctx, view } = r
      const rise = easeOutCubic(clamp01(p / 0.7)) * view.px(30)
      const a = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1
      const pop = p < 0.1 ? 0.55 + (p / 0.1) * 0.6 : p < 0.18 ? 1.15 - ((p - 0.1) / 0.08) * 0.15 : 1
      const fs = view.px(style.size) * pop
      ctx.save()
      ctx.font = `${style.italic ? 'italic ' : ''}${style.weight ?? 800} ${fs}px ${r.pal.font}`
      const half = ctx.measureText(text).width / 2 + view.px(style.dot ? 14 : 6)
      ctx.restore()
      const vis = view.visible()
      const x = Math.max(vis.minX + half, Math.min(vis.maxX - half, h.x))
      // Bord haut de la vue : on borne en gardant l'écart entre emplacements (pas de superposition).
      const y = Math.max(vis.minY + fs * 1.6 + slot * view.px(slotPx), h.y - view.px(4) - rise - slot * view.px(slotPx))
      ctx.save()
      ctx.globalAlpha *= a
      ctx.font = `${style.italic ? 'italic ' : ''}${style.weight ?? 800} ${fs}px ${r.pal.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.lineJoin = 'round'
      ctx.lineWidth = view.px(3.6)
      ctx.strokeStyle = 'rgba(20, 12, 6, 0.85)'
      const w = ctx.measureText(text).width
      let tx = x
      if (style.dot) {
        const dr = fs * 0.24
        tx = x + dr
        ctx.beginPath()
        ctx.arc(x - w / 2 - dr * 0.6, y - fs * 0.33, dr, 0, Math.PI * 2)
        ctx.fillStyle = style.dot
        ctx.fill()
        ctx.lineWidth = view.px(1.5)
        ctx.stroke()
        ctx.lineWidth = view.px(3.6)
      }
      ctx.strokeText(text, tx, y)
      ctx.fillStyle = style.color
      ctx.fillText(text, tx, y)
      if (style.sub) {
        const sfs = view.px(10.5)
        ctx.font = `800 ${sfs}px ${r.pal.font}`
        ctx.lineWidth = view.px(3)
        ctx.strokeText(style.sub.text, x, y - fs * 0.95)
        ctx.fillStyle = style.sub.color
        ctx.fillText(style.sub.text, x, y - fs * 0.95)
      }
      ctx.restore()
    },
  }
}

