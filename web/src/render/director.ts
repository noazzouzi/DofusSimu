/**
 * Metteur en scène : traduit chaque événement du replay en animations (Canvas) et bannières
 * (DOM), et indique combien de temps attendre avant l'événement suivant.
 *
 *   move      → déplacement case par case (≈ 210 ms / case)
 *   cast      → impulsion du lanceur + nom du sort, projectile coloré par élément, éclat de zone
 *   damage    → texte rouge teinté par l'élément (« critique ! »), flash + tremblement de la cible
 *   heal      → texte vert + étincelles ; shield → texte violet + hexagone
 *   apmp      → « -2 PA » (bleu) / « -1 PM » (vert) ; tackle → idem avec « tacle »
 *   buff/state→ libellé flottant ; push → glissade (+ choc) ; teleport → disparition / réapparition
 *   summon    → apparition avec rebond ; wave → bannière + apparitions échelonnées
 *   death     → bascule et fondu ; glyph/trap → pulsation du contour
 *   roundStart / turnStart → bannières ; log 'ai' → bulle de pensée ; fightEnd → écran de résultat
 */
import type { FightEvent } from '@/engine/types'
import { distance, isValidCell } from '@/map/geometry'
import { getFighter } from '@/replay/reducer'
import { formatInt } from '@/replay/log'
import type { FighterView, ViewState } from '@/replay/types'
import {
  bubbleAnim,
  castPulseAnim,
  deathAnim,
  floatTextAnim,
  hitAnim,
  moveAnim,
  overlayPulseAnim,
  projectileAnim,
  ringAnim,
  slideAnim,
  spawnAnim,
  sparkleAnim,
  spellLabelAnim,
  teleportAnim,
  zoneFlashAnim,
  type FloatStyle,
} from './anims'
import type { StageRenderer } from './renderer'
import { cellCenter, type Pt } from './view'

export interface DirectorUi {
  turnBanner(f: FighterView, ap: number, mp: number): void
  bigBanner(text: string, kind: 'round' | 'wave'): void
  infoStrip(text: string, level: 'info' | 'warn'): void
}

const MS_PER_CELL = 210
const CONSEQUENCES = new Set<FightEvent['t']>(['damage', 'heal', 'shield', 'apmp', 'buff', 'unbuff', 'state', 'push', 'teleport', 'death', 'summon', 'glyph', 'trap', 'log'])

const KIND_LABEL: Record<string, string> = {
  push: 'poussée',
  poison: 'poison',
  trap: 'piège',
  glyph: 'glyphe',
  reflect: 'renvoi',
  steal: 'vol de vie',
  indirect: 'indirect',
}

/** Texte flottant récent : sert à empiler les textes proches pour qu'ils ne se chevauchent pas. */
interface TextSlot {
  x: number
  y: number
  t0: number
  slot: number
  h: number
}

/** Hauteur d'un emplacement de texte flottant (px CSS, voir floatTextAnim). */
const SLOT_PX = 19
/** Un texte reste « en bas » de sa course (et peut gêner un nouveau texte) pendant ce délai. */
const TEXT_BUSY_MS = 560

/** Événements qui ne sont pas des actions de jeu (un tour sans autre événement est un tour passé). */
const PASSIVE = new Set<FightEvent['t']>(['log', 'apmp', 'unbuff', 'state', 'glyph', 'trap', 'buff'])

export class Director {
  private texts: TextSlot[] = []

  constructor(
    private readonly r: StageRenderer,
    private readonly ui: DirectorUi,
  ) {}

  reset(): void {
    this.texts = []
  }

  private elColor(el: number | undefined): string {
    if (el === undefined || el < 0 || el > 4) return this.r.pal.accent
    return this.r.pal.elements[el]
  }

  /**
   * Emplacement vertical d'un texte flottant (en « emplacements » de SLOT_PX px au-dessus de la
   * tête, éventuellement fractionnaire) : le plus bas dont la bande verticale, en coordonnées
   * ABSOLUES de la carte, ne chevauche aucun texte récent d'un combattant voisin à l'écran (ou du
   * même combattant). Les têtes voisines n'étant pas à la même hauteur, l'empilement se fait sur
   * des positions absolues et non sur des numéros d'emplacement. Un texte avec sous-titre
   * (« critique ! », « bouclier »...) occupe deux emplacements.
   */
  private slot(cell: number, t0: number, h: number): number {
    const k = Math.max(0.05, this.r.view.k)
    const unit = SLOT_PX / k
    const c = cellCenter(cell)
    this.texts = this.texts.filter(t => t.t0 > t0 - TEXT_BUSY_MS && t.t0 <= t0 + TEXT_BUSY_MS)
    const busy = this.texts.filter(t => Math.abs(t.x - c.x) * k < 76 && Math.abs(t.y - c.y) * k < 44)
    // Bande occupée [haut, bas] (y croissant vers le bas), avec une petite marge.
    const band = (y: number, slot: number, span: number) => [y - (slot + span) * unit, y - slot * unit + 0.25 * unit]
    let slot = 0
    for (; slot < 8; slot += 0.5) {
      const [top, bottom] = band(c.y, slot, h)
      if (!busy.some(t => {
        const [bt, bb] = band(t.y, t.slot, t.h)
        return top < bb && bt < bottom
      })) break
    }
    this.texts.push({ x: c.x, y: c.y, t0, slot, h })
    return slot
  }

  private text(f: FighterView, text: string, style: FloatStyle, t0: number, dur?: number): void {
    const h = style.sub || style.size >= 20 ? 2 : 1
    this.r.add(floatTextAnim(f.id, text, style, t0, this.slot(f.cell, t0, h), dur, SLOT_PX, h))
  }

  /**
   * Point de caméra pour un lancer quand la carte est zoomée (téléphone) : entre le lanceur et la
   * cible, mais toujours de façon que la cible reste visible avec, au-dessus d'elle, la place des
   * textes de dégâts empilés (marge haute plus grande que les autres).
   */
  private castFocus(from: Pt, to: Pt): Pt {
    const v = this.r.view
    const mx = from.x * 0.4 + to.x * 0.6
    const my = from.y * 0.4 + to.y * 0.6 - 20
    if (v.zoom <= 1.001) return { x: mx, y: my }
    const clampTo = (val: number, lo: number, hi: number, fallback: number) => (lo > hi ? fallback : Math.max(lo, Math.min(hi, val)))
    const side = 80
    const top = 160
    const bottom = 60
    return {
      x: clampTo(mx, to.x - v.visW / 2 + side, to.x + v.visW / 2 - side, to.x),
      y: clampTo(my, to.y + bottom - v.visH / 2, to.y - top + v.visH / 2, to.y - (top - bottom) / 2),
    }
  }

  /** Vrai si le tour du combattant qui finit (événement `turnEnd` d'index i) n'a contenu aucune action. */
  private passedTurn(events: FightEvent[], i: number, fighter: number): boolean {
    for (let j = i - 1; j >= 0; j--) {
      const e = events[j]
      if (e.t === 'turnStart') return e.fighter === fighter
      if (!PASSIVE.has(e.t)) return false
    }
    return false
  }

  /** Apparition des combattants au chargement d'un replay. */
  intro(state: ViewState, t0: number): void {
    state.fighters.forEach((f, k) => {
      if (!f.alive) return
      this.r.add(spawnAnim(f.id, f.cell, t0 + 80 + k * 70, 520, f.team === 0 ? this.r.pal.team0 : this.r.pal.team1))
    })
  }

  /**
   * Anime l'événement `events[i]` ; `prev` / `next` = états avant / après.
   * Retourne la durée (ms d'horloge de replay) avant de jouer l'événement suivant.
   */
  apply(events: FightEvent[], i: number, prev: ViewState, next: ViewState, t0: number): number {
    const ev = events[i]
    const after = events[i + 1]
    const lastOfAction = !after || !CONSEQUENCES.has(after.t)
    const pal = this.r.pal
    const F = (s: ViewState, id: number | undefined) => getFighter(s, id)

    switch (ev.t) {
      case 'fightStart':
        return 600
      case 'roundStart':
        this.ui.bigBanner(`Tour ${ev.round}`, 'round')
        return 950
      case 'turnStart': {
        const f = F(next, ev.fighter)
        this.r.releaseCamera()
        if (f) {
          this.ui.turnBanner(f, ev.ap, ev.mp)
          this.r.add(ringAnim(cellCenter(f.cell), t0, 700, pal.gold, 40))
        }
        return 620
      }
      case 'turnEnd': {
        const f = F(next, ev.fighter)
        if (f && f.alive && this.passedTurn(events, i, ev.fighter)) {
          this.text(f, 'passe son tour', { color: '#e8dccb', size: 12, weight: 650, italic: true }, t0, 1100)
          return 520
        }
        return 160
      }
      case 'move': {
        if (ev.path.length < 2) return 0
        const dur = MS_PER_CELL * (ev.path.length - 1)
        this.r.add(moveAnim(ev.fighter, ev.path, t0, MS_PER_CELL))
        return dur + 60
      }
      case 'tackle': {
        const f = F(next, ev.fighter)
        if (f) {
          this.r.add(hitAnim(f.id, t0, pal.ap, false))
          if (ev.apLost) this.text(f, `-${ev.apLost} PA`, { color: pal.ap, size: 14, sub: { text: 'tacle', color: '#fff' } }, t0)
          if (ev.mpLost) this.text(f, `-${ev.mpLost} PM`, { color: pal.mp, size: 14, sub: ev.apLost ? undefined : { text: 'tacle', color: '#fff' } }, t0 + 60)
        }
        return 520
      }
      case 'cast': {
        const caster = F(prev, ev.fighter)
        const color = this.elColor(ev.element)
        this.r.add(castPulseAnim(ev.fighter, t0, color))
        this.r.add(spellLabelAnim(ev.fighter, ev.spellName, t0, color, ev.crit))
        const zone = ev.zone.filter(isValidCell)
        const cells = zone.length ? zone : isValidCell(ev.cell) ? [ev.cell] : []
        const from = caster && isValidCell(caster.cell) ? caster.cell : ev.cell
        const d = isValidCell(from) && isValidCell(ev.cell) ? distance(from, ev.cell) : 0
        if (d === 0) {
          if (cells.length) this.r.add(zoneFlashAnim(cells, ev.cell, t0 + 160, 620, color))
          return 460
        }
        const travel = Math.max(220, Math.min(560, 150 + d * 30))
        const start = cellCenter(from)
        const end = cellCenter(ev.cell)
        this.r.focus(this.castFocus(start, end), t0 + 130 + travel + 1100)
        this.r.add(projectileAnim(ev.fighter, { x: start.x, y: start.y - 30 }, cellCenter(ev.cell), t0 + 130, travel, color))
        if (cells.length) this.r.add(zoneFlashAnim(cells, ev.cell, t0 + 130 + travel - 30, 680, color))
        return 130 + travel + 60
      }
      case 'damage': {
        const t = F(next, ev.target)
        if (!t) return 0
        const el = ev.element >= 0 ? ev.element : undefined
        const elColor = this.elColor(el)
        const indirect = KIND_LABEL[ev.kind]
        if (ev.amount > 0 || !ev.shieldAbsorbed) {
          const style: FloatStyle = {
            // Rouge franc (comme dans le jeu) ; l'élément est donné par la pastille colorée.
            color: '#ff5240',
            size: ev.crit ? 22 : indirect ? 14 : 17,
            dot: el !== undefined ? elColor : undefined,
            sub: ev.crit ? { text: 'critique !', color: pal.gold } : indirect ? { text: indirect, color: '#fff' } : undefined,
          }
          this.text(t, `-${formatInt(ev.amount)}`, style, t0, ev.crit ? 1700 : 1500)
        }
        if (ev.shieldAbsorbed) this.text(t, `-${formatInt(ev.shieldAbsorbed)}`, { color: pal.shield, size: 14, sub: { text: 'bouclier', color: '#fff' } }, t0 + 40)
        this.r.add(hitAnim(t.id, t0, ev.crit ? '#fff3c4' : '#ffffff', !!ev.crit))
        this.r.holdFocus(t0 + 1100)
        // Coup fatal : laisser la barre de vie se vider avant l'animation de mort.
        if (after?.t === 'death' && after.target === ev.target) return 340
        return lastOfAction ? 420 : 170
      }
      case 'heal': {
        const t = F(next, ev.target)
        if (!t) return 0
        this.text(t, `+${formatInt(ev.amount)}`, { color: pal.heal, size: 17 }, t0)
        this.r.add(sparkleAnim(t.id, t0, pal.heal, 'plus'))
        return lastOfAction ? 420 : 200
      }
      case 'shield': {
        const t = F(next, ev.target)
        if (!t) return 0
        this.text(t, `+${formatInt(ev.amount)}`, { color: pal.shield, size: 16, sub: { text: 'bouclier', color: '#fff' } }, t0)
        this.r.add(sparkleAnim(t.id, t0, pal.shield, 'hex'))
        return lastOfAction ? 420 : 200
      }
      case 'apmp': {
        if (ev.reason === 'cast' || ev.reason === 'move') return 0
        const before = events[i - 1]
        if (before && (before.t === 'buff' || before.t === 'unbuff') && before.target === ev.target) return 0
        const a = F(prev, ev.target)
        const b = F(next, ev.target)
        if (!a || !b) return 0
        const dAp = b.ap - a.ap
        const dMp = b.mp - a.mp
        if (dAp) this.text(b, `${dAp > 0 ? '+' : ''}${dAp} PA`, { color: pal.ap, size: 15 }, t0)
        if (dMp) this.text(b, `${dMp > 0 ? '+' : ''}${dMp} PM`, { color: pal.mp, size: 15 }, t0 + 50)
        return dAp || dMp ? (lastOfAction ? 380 : 200) : 0
      }
      case 'buff': {
        const t = F(next, ev.target)
        if (!t) return 0
        const color = /\bPA\b/.test(ev.label) ? pal.ap : /\bPM\b/.test(ev.label) ? pal.mp : pal.gold
        this.text(t, ev.label, { color, size: 13, weight: 750 }, t0, 1400)
        return lastOfAction ? 380 : 220
      }
      case 'unbuff': {
        const t = F(prev, ev.target)
        const b = t?.buffs.find(x => x.uid === ev.uid)
        if (!t || !t.alive || !b) return 0
        this.text(t, `fin : ${b.label}`, { color: '#e8dccb', size: 12, weight: 600, italic: true }, t0, 1200)
        return lastOfAction ? 260 : 120
      }
      case 'state': {
        const t = F(next, ev.target) ?? F(prev, ev.target)
        if (!t) return 0
        if (ev.added) this.text(t, ev.name, { color: '#cdb6ff', size: 13, weight: 700, italic: true }, t0, 1500)
        else this.text(t, `fin : ${ev.name}`, { color: '#e8dccb', size: 12, weight: 600, italic: true }, t0, 1300)
        return lastOfAction ? 420 : 240
      }
      case 'push': {
        const t = F(next, ev.target)
        if (!t || !isValidCell(ev.from) || !isValidCell(ev.to)) return 0
        const collision = ev.collisionWith !== undefined || ev.collisionDamage !== undefined
        const cells = distance(ev.from, ev.to)
        const dur = cells > 0 ? 180 + 70 * cells : 120
        this.r.add(slideAnim(t.id, ev.from, ev.to, t0, dur, collision))
        if (collision) this.r.add(ringAnim(cellCenter(ev.to), t0 + dur, 380, '#d8c3a0', 30))
        return dur + (collision ? 180 : 40)
      }
      case 'teleport': {
        const t = F(next, ev.target)
        if (!t || !isValidCell(ev.from) || !isValidCell(ev.to)) return 0
        this.r.add(teleportAnim(t.id, ev.from, ev.to, t0, 520, '#a77bf3'))
        return 520
      }
      case 'summon': {
        const color = ev.fighter.team === 0 ? pal.team0 : pal.team1
        this.r.add(spawnAnim(ev.fighter.id, ev.fighter.cell, t0, 560, color))
        return 620
      }
      case 'wave': {
        this.ui.bigBanner(`Vague ${ev.index}/${ev.total}`, 'wave')
        if (ev.fighters.length) {
          const pts = ev.fighters.map(f => cellCenter(f.cell))
          this.r.focus({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length - 20 }, t0 + 1800)
        }
        ev.fighters.forEach((f, k) => this.r.add(spawnAnim(f.id, f.cell, t0 + 450 + k * 220, 600, f.team === 0 ? pal.team0 : pal.team1)))
        return ev.fighters.length ? 1150 + ev.fighters.length * 220 : 1100
      }
      case 'death': {
        const t = F(prev, ev.target)
        if (!t) return 0
        this.r.add(deathAnim(t.id, t0, 820))
        this.r.add(ringAnim(cellCenter(t.cell), t0 + 200, 600, '#bdb2a2', 30))
        this.text(t, 'vaincu', { color: '#f1e6d4', size: 13, weight: 700, italic: true }, t0 + 60, 1200)
        return 820
      }
      case 'glyph':
      case 'trap': {
        const data = ev.t === 'glyph' ? ev.glyph : ev.trap
        this.r.add(overlayPulseAnim(data.cells, t0, data.color, ev.added))
        return ev.added ? 460 : 160
      }
      case 'log': {
        if (ev.level === 'ai') {
          const who = next.current ?? next.lastCast?.fighter
          const f = F(next, who ?? undefined)
          if (f && f.alive) {
            this.r.add(bubbleAnim(f.id, ev.text, t0, 2600))
            return 900
          }
          this.ui.infoStrip(ev.text, 'info')
          return 700
        }
        this.ui.infoStrip(ev.text, ev.level === 'warn' ? 'warn' : 'info')
        return ev.level === 'warn' ? 1100 : 800
      }
      case 'fightEnd':
        return 0
    }
    return 0
  }
}

