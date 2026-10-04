/**
 * Tacle et fuite — docs/research/formulas.md §14 (DoMath `/tacle-fuite` : `Ek`, `bk`, `wk`, `xk` ; devblog
 * « Tacle déterministe » ; client D2 `TackleUtil` / `FightTurnFrame`).
 *
 *   ratio(case) = Π_{tacleurs adjacents} min(1, (max(0, Fuite) + 2) / (2 × (max(0, Tacle) + 2)))
 *   PA = roundHalfDown(PA × ratio) ; PM = roundHalfDown(PM × ratio) (si PM > 0) ; puis −1 PM pour le pas.
 *
 * Tacle = Agilité/10 + bonus, Fuite = Agilité/10 + bonus (calculés par l'agrégateur de caractéristiques).
 */
import { roundHalfDown } from './math'

/** Proportion de PA/PM conservée face à UN tacleur. */
export function tackleRatio(dodge: number, lock: number): number {
  const r = ((dodge > 0 ? dodge : 0) + 2) / (2 * ((lock > 0 ? lock : 0) + 2))
  return r < 1 ? r : 1
}

/** Proportion conservée en quittant une case au contact de plusieurs tacleurs (produit des ratios). */
export function escapeRatio(dodge: number, locks: readonly number[]): number {
  let ratio = 1
  for (let i = 0; i < locks.length; i++) ratio *= tackleRatio(dodge, locks[i])
  return ratio
}

/**
 * PA ou PM restants après le tacle d'une case.
 * `domath` (défaut) : `roundHalfDown(points × ratio)` (le joueur perd l'arrondi à .5 près) ;
 * `dofus2` : client officiel, `points − trunc(points × (1 − ratio) + 0,5)` (diffère sur 8 cas / 122 412,
 * artefact flottant de `1 − ratio`). Des points ≤ 0 ne sont pas modifiés.
 */
export function apMpAfterTackle(points: number, ratio: number, variant: 'domath' | 'dofus2' = 'domath'): number {
  if (points <= 0 || ratio >= 1) return points
  if (variant === 'dofus2') return points - Math.trunc(points * (1 - ratio) + 0.5)
  return roundHalfDown(points * ratio)
}

/** Points perdus selon le client officiel D2 : `trunc(points × (1 − ratio) + 0,5)`. */
export function tackleLossDofus2(points: number, ratio: number): number {
  return Math.trunc(points * (1 - ratio) + 0.5)
}

export interface TackleCell {
  /** Proportion conservée sur cette case (fraction 0..1). */
  remainingPercent: number
  /** PA / PM après le tacle de la case, AVANT le coût du pas (tableau DoMath `bk`). */
  ap: number
  mp: number
}

export interface TacklePathResult {
  perCell: TackleCell[]
  /** État après le chemin (DoMath `Ek`) : 1 PM décompté par case, y compris la dernière ; négatif = impossible. */
  afterPath: { ap: number; mp: number }
}

function cellRatio(dodge: number, lockers: readonly number[], cell: readonly number[], skipFirstLocker: boolean): number {
  let ratio = 1
  for (const idx of cell) {
    if (skipFirstLocker && idx === 0) continue
    ratio *= tackleRatio(dodge, lockers[idx] ?? 0)
  }
  return ratio
}

/**
 * Déroule un chemin DoMath : `composition[c]` = indices (dans `lockers`) des tacleurs adjacents à la c-ième case
 * quittée. Reproduit `bk` (tableau par case) et `Ek` (bilan du chemin), y compris leurs différences de garde.
 */
export function tacklePath(
  dodge: number,
  lockers: readonly number[],
  composition: readonly (readonly number[])[],
  ap: number,
  mp: number,
): TacklePathResult {
  const perCell: TackleCell[] = []
  // bk : multiplie toujours les PM, ne décompte le pas qu'entre deux cases.
  let s = ap
  let l = mp
  // Ek : ne multiplie les PM que s'ils sont positifs, décompte un PM après chaque case.
  let g = ap
  let d = mp
  for (let c = 0; c < composition.length; c++) {
    const m = cellRatio(dodge, lockers, composition[c], false)
    s = roundHalfDown(s * m)
    l = roundHalfDown(l * m)
    perCell.push({ remainingPercent: m, ap: s, mp: l })
    if (c < composition.length - 1) l--
    g = roundHalfDown(g * m)
    if (d > 0) d = roundHalfDown(d * m)
    d--
  }
  return { perCell, afterPath: { ap: g, mp: d } }
}

/** `Ek` de DoMath : PA/PM restants après le chemin. */
function ekAfter(dodge: number, lockers: readonly number[], composition: readonly (readonly number[])[], ap: number, mp: number) {
  let g = ap
  let d = mp
  for (let c = 0; c < composition.length; c++) {
    const m = cellRatio(dodge, lockers, composition[c], false)
    g = roundHalfDown(g * m)
    if (d > 0) d = roundHalfDown(d * m)
    d--
  }
  return { ap: g, mp: d }
}

/** Recherche dichotomique DoMath `xk` : plus petite valeur `c` telle que f(c) = cible et f(c − 1) ≠ cible. */
function bisect(lo: number, hi: number, target: number, decreasing: boolean, f: (c: number) => number): number {
  for (let iter = 0; lo <= hi && iter < 100; iter++) {
    const c = Math.floor((lo + hi) / 2)
    const u = f(c)
    const m = f(c - 1)
    if (u === target && u !== m) return c
    if ((!decreasing && u < target) || (decreasing && u > target)) lo = c + 1
    else hi = c - 1
  }
  return lo
}

export interface TackleThresholdRow {
  /** Nombre de PA/PM restants visé. */
  remaining: number
  /** Tacle (ou fuite) minimum. */
  value: number
}

export interface TackleThresholds {
  /** Tacle minimum du premier tacleur pour ne laisser que `remaining` PA. */
  minLockForRemainingAp: TackleThresholdRow[]
  minLockForRemainingMp: TackleThresholdRow[]
  /** Fuite minimum pour conserver au moins `remaining` PA. */
  minDodgeToKeepAp: TackleThresholdRow[]
  minDodgeToKeepMp: TackleThresholdRow[]
}

/**
 * Tableaux « Tacle min. » / « Fuite min. » de DoMath (composant `wk`), à l'identique : formules inverses pour un
 * chemin d'une case, recherche dichotomique `xk` sur `Ek` pour plusieurs cases. Quirk conservé : pour le tacle
 * minimum sur plusieurs cases, la borne haute de recherche utilise les PM même pour la ligne des PA.
 * Le tacleur dont on cherche le tacle minimum est `lockers[0]`. Au plus 20 lignes par tableau.
 */
export function tackleThresholds(
  dodge: number,
  lockers: readonly number[],
  composition: readonly (readonly number[])[],
  ap: number,
  mp: number,
): TackleThresholds {
  const multiCell = composition.length > 1
  // Produit des ratios des AUTRES tacleurs (hors lockers[0]) pour chaque case, et tacles triés par ordre décroissant.
  const others = composition.map(cell => cellRatio(dodge, lockers, cell, true))
  const sortedLocks: number[] = []
  for (const cell of composition) for (const idx of cell) sortedLocks.push(lockers[idx])
  sortedLocks.sort((x, y) => y - x)
  const otherLockers = lockers.slice(1)

  const minLock = (points: number, isAp: boolean): TackleThresholdRow[] => {
    const rows: TackleThresholdRow[] = []
    for (let n = 0; n < Math.min(20, points); n++) {
      const remaining = points - 1 - n
      let value: number
      if (multiCell) {
        const target = isAp ? remaining : remaining - composition.length
        const f = (c: number) => {
          const res = ekAfter(dodge, [c, ...otherLockers], composition, isAp ? ap : 0, isAp ? 0 : mp)
          return isAp ? res.ap : res.mp
        }
        value = bisect(0, (dodge + 2) * mp - 2, target, true, f)
      } else {
        value = Math.ceil(((dodge + 2) * points * others[0]) / (2 * remaining + 1) - 2)
      }
      rows.push({ remaining, value })
    }
    return rows
  }

  const minDodge = (points: number, isAp: boolean): TackleThresholdRow[] => {
    const rows: TackleThresholdRow[] = []
    for (let n = 0; n < Math.min(20, points); n++) {
      let value = 0
      if (multiCell) {
        const target = isAp ? n + 1 : n - composition.length + 1
        const f = (c: number) => {
          const res = ekAfter(c, lockers, composition, isAp ? ap : 0, isAp ? 0 : mp)
          return isAp ? res.ap : res.mp
        }
        value = bisect(0, lockers.reduce((acc, t) => acc + 2 * t, 2), target, false, f)
      } else {
        for (let e = 0; e < sortedLocks.length && (value - 2) / 2 < sortedLocks[e]; e++) {
          let prod = 1
          for (let a = 0; a < sortedLocks.length; a++) prod *= a <= e ? sortedLocks[a] + 2 : 1
          const x = Math.max(0, (2 ** (e + 1) * prod * (n + 0.5)) / points)
          value = Math.max(0, Math.floor(x ** (1 / (e + 1)) - 1))
        }
      }
      rows.push({ remaining: n + 1, value })
    }
    return rows
  }

  return {
    minLockForRemainingAp: minLock(ap, true),
    minLockForRemainingMp: minLock(mp, false),
    minDodgeToKeepAp: minDodge(ap, true),
    minDodgeToKeepMp: minDodge(mp, false),
  }
}
