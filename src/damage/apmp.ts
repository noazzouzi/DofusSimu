/**
 * Retrait de PA/PM esquivable — docs/research/formulas.md §15 (note de version 1.25.0, émulateurs OtomAI/Giny).
 *
 * Chaque point est tiré séparément :
 *   P(point k) = clamp(10 %, 90 %, (points_actuels − déjà_retirés) / points_max × Retrait / Esquive / 2)
 * avec Retrait et Esquive ramenés à 1 au minimum ; on s'arrête quand la cible n'a plus de point.
 * INCERTAIN : `points_max` = PA/PM max du tour (OtomAI/Stump `TotalMax`) ou total courant (Giny).
 */

/** Probabilité de retirer le prochain point (0 si la cible n'a plus de point à perdre). */
export function apMpRemovalProbability(
  removal: number,
  dodge: number,
  currentPoints: number,
  maxPoints: number,
  alreadyRemoved = 0,
): number {
  const remaining = currentPoints - alreadyRemoved
  if (remaining <= 0) return 0
  const ra = removal > 1 ? removal : 1
  const es = dodge > 1 ? dodge : 1
  const max = maxPoints > 0 ? maxPoints : currentPoints
  // Même ordre d'opérations que les émulateurs : (restants / max) × (ra / es) / 2.
  const p = ((remaining / max) * (ra / es)) / 2
  return p < 0.1 ? 0.1 : p > 0.9 ? 0.9 : p
}

/**
 * Tire séquentiellement `attempted` points avec le générateur `rng` (uniforme dans [0, 1)) ;
 * retourne le nombre de points retirés.
 */
export function rollApMpRemoval(
  removal: number,
  dodge: number,
  currentPoints: number,
  maxPoints: number,
  attempted: number,
  rng: () => number,
): number {
  let removed = 0
  for (let i = 0; i < attempted && removed < currentPoints; i++) {
    if (rng() < apMpRemovalProbability(removal, dodge, currentPoints, maxPoints, removed)) removed++
  }
  return removed
}

/** Distribution exacte du nombre de points retirés : `dist[k]` = P(k points retirés), k = 0..attempted. */
export function apMpRemovalDistribution(
  removal: number,
  dodge: number,
  currentPoints: number,
  maxPoints: number,
  attempted: number,
): number[] {
  const n = attempted > 0 ? Math.floor(attempted) : 0
  let dist = new Array<number>(n + 1).fill(0)
  dist[0] = 1
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(n + 1).fill(0)
    for (let k = 0; k <= i; k++) {
      const pk = dist[k]
      if (pk === 0) continue
      const p = apMpRemovalProbability(removal, dodge, currentPoints, maxPoints, k)
      next[k + 1] += pk * p
      next[k] += pk * (1 - p)
    }
    dist = next
  }
  return dist
}

/** Espérance du nombre de points retirés. */
export function expectedApMpRemoved(
  removal: number,
  dodge: number,
  currentPoints: number,
  maxPoints: number,
  attempted: number,
): number {
  const dist = apMpRemovalDistribution(removal, dodge, currentPoints, maxPoints, attempted)
  let mean = 0
  for (let k = 1; k < dist.length; k++) mean += k * dist[k]
  return mean
}
