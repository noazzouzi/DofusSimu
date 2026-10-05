/**
 * Points de caractéristiques et parchemins (niveau L3, docs/design/ai.md §15.4 point 6) — WP4b.
 *
 * Répartitions candidates (src/stats `allocateAll`, coûts par paliers de Dofus 3) :
 *  - `all` : tout dans l'élément principal (398 au niveau 200), reste en Vitalité ;
 *  - `cap300` : 300 dans l'élément, le reste (395) en Vitalité ;
 *  - tank : `cap100` (100 élément + Vitalité) et `vitality` (tout en Vitalité) ;
 *  - retrait (mpLock / apLock) : `wisdom100` (100 Sagesse puis l'élément) ;
 *  - `preset` : la répartition du preset (data/ai/presets.json), si fournie.
 * Parchemins : 100 dans les six caractéristiques (`fullScrolls`) — personnage « parchoté ».
 */
import type { RoleId } from '../../ai/types'
import type { BreedData } from '../../data/model'
import { allocateAll, type PrimaryStat, type PrimaryStatRecord } from '../../stats/characteristicPoints'
import { fullScrolls } from '../../stats/build'

export interface PointsOption {
  id: string
  label: string
  points: Partial<PrimaryStatRecord>
}

/** Parchemins complets (+100 partout). */
export function scrollsFor(): PrimaryStatRecord {
  return fullScrolls()
}

/** Répartitions candidates d'un personnage (voir l'en-tête), sans doublon de points. */
export function pointsOptions(breed: BreedData | undefined, level: number, primary: PrimaryStat, role: RoleId, preset?: Partial<PrimaryStatRecord>): PointsOption[] {
  const out: PointsOption[] = []
  const push = (id: string, label: string, points: Partial<PrimaryStatRecord>) => {
    const key = JSON.stringify(points)
    if (out.some(o => JSON.stringify(o.points) === key)) return
    out.push({ id, label, points })
  }
  if (preset) push('preset', 'répartition du preset', { ...preset })
  push('all', `tout en ${primary}, reste en Vitalité`, allocateAll(breed, level, primary).points)
  push('cap300', `300 en ${primary}, reste en Vitalité`, allocateAll(breed, level, primary, { primaryCap: 300 }).points)
  if (role === 'tank') {
    push('cap100', `100 en ${primary}, reste en Vitalité`, allocateAll(breed, level, primary, { primaryCap: 100 }).points)
    push('vitality', 'tout en Vitalité', allocateAll(breed, level, 'vitality').points)
  }
  if (role === 'mpLock' || role === 'apLock') {
    push('wisdom100', `100 en Sagesse, reste en ${primary}`, allocateAll(breed, level, 'wisdom', { primaryCap: 100, rest: primary }).points)
  }
  return out
}
