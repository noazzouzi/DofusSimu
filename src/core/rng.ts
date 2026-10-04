/**
 * Générateur pseudo-aléatoire déterministe (sfc32) : un même seed rejoue exactement
 * le même combat, ce qui permet de comparer des stratégies et de rejouer un replay.
 */
export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: number) {
    this.a = 0x9e3779b9
    this.b = 0x243f6a88
    this.c = 0xb7e15162
    this.d = seed >>> 0
    for (let i = 0; i < 15; i++) this.next()
  }

  /** Flottant uniforme dans [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0
    let t = (this.a + this.b) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.d = (this.d + 1) | 0
    t = (t + this.d) | 0
    this.c = (this.c + t) | 0
    return (t >>> 0) / 4294967296
  }

  /** Entier uniforme dans [min, max] (bornes incluses). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Vrai avec une probabilité p (0..1). */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /** Nouvel Rng indépendant dérivé de celui-ci (pour les sous-simulations). */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296))
  }
}
