/**
 * Lecteur : horloge de replay (ms × vitesse), lecture/pause, pas à pas, saut à un index.
 * Les événements sont appliqués quand l'horloge atteint l'échéance fixée par le metteur en scène.
 */
import type { ReplayTimeline } from '@/replay/reducer'
import type { ViewState } from '@/replay/types'

export interface PlayerHooks {
  /** Anime l'événement `i` (déjà appliqué à l'état) et retourne le temps de maintien (ms). */
  apply(i: number, prev: ViewState, next: ViewState, t0: number): number
  /** Saut sans animation vers un état. */
  seek(state: ViewState): void
  /** L'index, l'état de lecture ou la vitesse ont changé. */
  change(): void
}

export const SPEEDS = [0.5, 1, 2, 4, 8] as const

export class Player {
  index = 0
  playing = false
  speed = 1
  /** Horloge du replay (ms), avance en continu (pour finir les animations même en pause). */
  clock = 0
  private nextAt = 0
  state: ViewState

  constructor(
    readonly tl: ReplayTimeline,
    private readonly hooks: PlayerHooks,
  ) {
    this.state = tl.stateAt(0)
  }

  get last(): number {
    return this.tl.length - 1
  }

  get atEnd(): boolean {
    return this.index >= this.last
  }

  tick(dtReal: number): void {
    this.clock += dtReal * this.speed
    if (!this.playing) return
    let guard = 0
    while (this.playing && this.clock >= this.nextAt && guard++ < 2000) {
      if (this.atEnd) {
        this.playing = false
        this.hooks.change()
        break
      }
      this.advance(this.nextAt)
    }
  }

  private advance(t0: number): void {
    const prev = this.state
    this.index++
    this.state = this.tl.stateAt(this.index)
    const hold = this.hooks.apply(this.index, prev, this.state, t0)
    this.nextAt = t0 + Math.max(0, hold)
    this.hooks.change()
  }

  play(): void {
    if (this.atEnd) this.seek(0)
    this.playing = true
    this.nextAt = Math.max(this.nextAt, this.clock)
    this.hooks.change()
  }

  pause(): void {
    this.playing = false
    this.hooks.change()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  setSpeed(s: number): void {
    this.speed = s
    this.hooks.change()
  }

  /**
   * Événement suivant, animé. Si l'événement précédent est encore en cours d'animation, l'horloge
   * saute à son échéance : l'enchaînement reste identique à la lecture continue (pas de jeton qui
   * se téléporte au milieu d'un déplacement, pas de dégâts avant l'impact du projectile).
   */
  stepForward(): void {
    this.playing = false
    if (this.atEnd) {
      this.hooks.change()
      return
    }
    if (this.nextAt > this.clock) this.clock = this.nextAt
    this.advance(this.clock)
  }

  stepBack(): void {
    this.playing = false
    this.seek(this.index - 1)
  }

  /** Saut à l'index `i` ; `animate` rejoue l'animation de l'événement d'arrivée. */
  seek(i: number, animate = false): void {
    i = Math.max(0, Math.min(this.last, Math.floor(i)))
    if (animate && i > 0) {
      this.index = i - 1
      this.state = this.tl.stateAt(this.index)
      this.hooks.seek(this.state)
      this.advance(this.clock)
      return
    }
    this.index = i
    this.state = this.tl.stateAt(i)
    this.nextAt = this.clock
    this.hooks.seek(this.state)
    this.hooks.change()
  }

  nextTurn(): void {
    const t = this.tl.nextTurnIndex(this.index)
    this.seek(t < 0 ? this.last : t, t >= 0)
  }

  prevTurn(): void {
    const t = this.tl.prevTurnIndex(this.index)
    this.seek(t < 0 ? 0 : t, t >= 0)
  }
}
