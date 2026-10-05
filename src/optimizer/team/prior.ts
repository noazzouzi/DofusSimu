/**
 * Prior de composition d'équipe (niveau L5, docs/design/ai.md §15.6 points 2-3) — WP4b.
 *
 * Valeur a priori d'une équipe de presets, sans combat :
 *  - couverture des BESOINS en rôles du scénario (Vortex, `VORTEX_ROLE_NEEDS` : killer 2, mpLock 1, zoneDps 1,
 *    placer 0,5, healer 0,5, tank 0,5) : affectation des membres aux rôles maximisant Σ besoin couvert × aptitude
 *    (rôle principal 1, rôle secondaire 0,6 ; un killer couvre un besoin zoneDps à 0,8 et inversement, un apLock un
 *    besoin mpLock à 0,7…), énumération exhaustive (≤ 9⁴ affectations) ;
 *  - notes officielles des classes (DofusDB `roleScores` : Dégâts, Entrave, Placement, Tank, Soins, Protection,
 *    Amélioration, Invocation, 0-12) pour le rôle tenu : +10 % au plus ;
 *  - matrice de SYNERGIES des fiches de classe (data/research/class-mechanics/*.json, champ `synergies` : classes
 *    citées dans « with », `SYNERGY_LINKS`, vérifiée par tests/opt-team.test.ts) et compositions citées par les guides
 *    du Vortex (vortex.md §13.3) ;
 *  - pénalités : plus de 2 fois la même classe (interdit), aucun contrôle ni placeur, poison des Harpilles sans soin.
 * Archétypes (diversité du successive halving) : avec/sans soigneur, avec/sans placeur.
 */
import { ROLE_IDS, type RoleId } from '../../ai/types'
import type { BreedData } from '../../data/model'
import { VORTEX_ROLE_NEEDS } from '../../dungeons/vortex/constants'
import type { Preset } from './presets'

/**
 * Liens de synergie entre classes (paires d'ids triées → nombre de mentions croisées dans les champs `synergies` des
 * fiches de classe ; script de dérivation : classes citées dans « with » par nom normalisé ou alias). Généré depuis
 * data/research/class-mechanics/*.json (2026-10-04) et vérifié par les tests (cohérence avec les fiches).
 */
export const SYNERGY_LINKS: Readonly<Record<string, number>> = {
  '1-2': 4, '1-3': 3, '1-4': 3, '1-5': 2, '1-6': 1, '1-7': 2, '1-8': 2, '1-9': 2, '1-10': 1, '1-11': 2, '1-12': 2,
  '1-13': 1, '1-16': 1, '1-17': 2, '1-18': 2, '1-20': 1, '2-3': 3, '2-4': 3, '2-8': 2, '2-9': 1, '2-11': 1, '2-17': 1,
  '2-18': 1, '3-4': 2, '3-5': 2, '3-6': 1, '3-7': 2, '3-8': 2, '3-9': 2, '3-10': 1, '3-11': 1, '3-12': 1, '3-13': 1,
  '3-14': 1, '3-15': 1, '3-17': 1, '3-18': 1, '3-20': 1, '4-5': 2, '4-6': 2, '4-7': 2, '4-8': 1, '4-9': 2, '4-11': 1,
  '4-12': 2, '4-13': 2, '4-14': 1, '4-15': 1, '4-17': 2, '4-18': 1, '4-20': 1, '5-6': 1, '5-7': 2, '5-8': 2, '5-9': 2,
  '5-11': 2, '5-12': 1, '5-13': 2, '5-17': 2, '5-18': 2, '5-20': 1, '6-7': 2, '6-8': 2, '6-9': 1, '6-12': 1, '6-18': 1,
  '7-8': 2, '7-9': 2, '7-10': 1, '7-11': 2, '7-12': 2, '7-13': 1, '7-14': 1, '7-17': 1, '7-18': 1, '7-20': 1, '8-9': 1,
  '8-10': 1, '8-11': 2, '8-12': 2, '8-13': 1, '8-14': 1, '8-15': 1, '8-16': 1, '8-17': 1, '8-18': 2, '8-20': 2,
  '9-10': 1, '9-11': 3, '9-12': 3, '9-13': 1, '9-14': 1, '9-15': 2, '9-17': 1, '9-18': 1, '9-20': 1, '10-11': 2,
  '10-12': 2, '10-13': 1, '10-15': 1, '10-18': 1, '10-20': 1, '11-12': 2, '11-13': 1, '11-14': 1, '11-15': 1,
  '11-16': 1, '11-18': 1, '11-20': 1, '12-13': 1, '12-16': 1, '12-17': 1, '12-18': 1, '12-20': 1, '13-14': 2,
  '13-15': 2, '13-16': 1, '13-17': 1, '13-18': 1, '13-20': 1, '14-15': 2, '14-16': 3, '14-18': 1, '14-20': 1,
  '15-16': 2, '15-20': 1, '17-18': 3, '17-20': 2, '18-20': 3,
}

/** Clé d'une paire de classes. */
export function synergyKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

/** Compositions citées par les guides du Vortex (vortex.md §13.3) : classes requises (ids) et rôles visés. */
export const CITED_COMPOSITIONS: readonly { label: string; breeds: readonly number[] }[] = [
  { label: 'Roublard + Pandawa + 2 frappeurs (JOL n°1)', breeds: [13, 12] },
  { label: 'Crâ + Enutrof retrait PM (DPLN)', breeds: [9, 3] },
  { label: 'Éliotrope + retrait PM (JOL n°2)', breeds: [16, 3] },
  { label: 'Sadida + Pandawa tank (Hardi)', breeds: [10, 12] },
  { label: 'Pandawa + Sram (Hardi)', breeds: [12, 4] },
]

/** Note officielle DofusDB (`roleScores`) pertinente pour chaque rôle. */
const ROLE_SCORE_NAMES: Readonly<Record<RoleId, readonly string[]>> = {
  killer: ['Dégâts'],
  zoneDps: ['Dégâts'],
  mpLock: ['Entrave'],
  apLock: ['Entrave'],
  placer: ['Placement'],
  tank: ['Tank'],
  healer: ['Soins'],
  support: ['Amélioration', 'Protection'],
  summoner: ['Invocation'],
}

/** Aptitude d'un rôle tenu à couvrir un besoin (matrice de substitution). */
const COVER: Readonly<Partial<Record<RoleId, Partial<Record<RoleId, number>>>>> = {
  killer: { killer: 1, zoneDps: 0.8 },
  zoneDps: { zoneDps: 1, killer: 0.8 },
  mpLock: { mpLock: 1, apLock: 0.7 },
  apLock: { apLock: 1, mpLock: 0.7 },
  placer: { placer: 1, tank: 0.3 },
  tank: { tank: 1, placer: 0.3 },
  healer: { healer: 1, support: 0.5 },
  support: { support: 1, healer: 0.5 },
  summoner: { summoner: 1, tank: 0.3, placer: 0.3 },
}

/** Aptitude d'un preset à couvrir le besoin `need` (rôle principal 1, secondaire × 0,6). */
export function aptitude(p: Pick<Preset, 'role' | 'secondaryRole'>, need: RoleId): number {
  const main = COVER[p.role]?.[need] ?? 0
  const second = p.secondaryRole ? 0.6 * (COVER[p.secondaryRole]?.[need] ?? 0) : 0
  return Math.max(main, second)
}

export interface TeamPrior {
  /** Valeur a priori (≈ 0-1,5, plus haut = mieux). */
  score: number
  /** Besoins couverts (Σ min(besoin, couverture) / Σ besoins). */
  coverage: number
  /** Rôle affecté à chaque membre (affectation optimale). */
  assignment: RoleId[]
  synergy: number
  cited: string[]
  penalties: string[]
  archetype: TeamArchetype
}

export interface TeamArchetype {
  healer: boolean
  placer: boolean
}

/** Archétype d'une équipe (diversité). */
export function archetypeOf(presets: readonly Pick<Preset, 'role' | 'secondaryRole'>[]): TeamArchetype {
  const has = (r: RoleId) => presets.some(p => p.role === r || p.secondaryRole === r)
  return { healer: has('healer'), placer: has('placer') }
}

/** Clé lisible d'un archétype. */
export function archetypeKey(a: TeamArchetype): string {
  return `${a.healer ? 'soin' : 'sans-soin'}/${a.placer ? 'placeur' : 'sans-placeur'}`
}

const COVERAGE_MEMO = new Map<string, { coverage: number; assignment: RoleId[] }>()

/**
 * Couverture des besoins : affectation exhaustive des rôles (un rôle par membre parmi les besoins non nuls, ou son
 * rôle propre), mémoïsée par (rôles, notes officielles, besoins) — l'énumération T0 réutilise massivement le cache.
 */
export function coverageOf(presets: readonly Pick<Preset, 'role' | 'secondaryRole' | 'breedId'>[], needs: Partial<Record<RoleId, number>>, breeds?: (id: number) => BreedData | undefined): { coverage: number; assignment: RoleId[] } {
  const officialBonus = (p: Pick<Preset, 'breedId'>, r: RoleId): number => {
    const scores = breeds?.(p.breedId)?.roleScores
    if (!scores) return 1
    const v = Math.max(0, ...ROLE_SCORE_NAMES[r].map(n => scores[n] ?? 0))
    return 1 + 0.1 * Math.min(1, v / 12)
  }
  const key = `${presets.map(p => `${p.role}/${p.secondaryRole ?? ''}/${breeds ? p.breedId : ''}`).join(',')}|${JSON.stringify(needs)}`
  const hit = COVERAGE_MEMO.get(key)
  if (hit) return { coverage: hit.coverage, assignment: hit.assignment.slice() }
  const needRoles = ROLE_IDS.filter(r => (needs[r] ?? 0) > 0)
  const totalNeed = needRoles.reduce((a, r) => a + (needs[r] ?? 0), 0)
  let best = -1
  let bestAssign: RoleId[] = presets.map(p => p.role)
  const assign: RoleId[] = new Array(presets.length)
  const covered = new Map<RoleId, number>()
  const rec = (i: number): void => {
    if (i === presets.length) {
      let v = 0
      for (const r of needRoles) v += Math.min(needs[r] ?? 0, covered.get(r) ?? 0)
      if (v > best + 1e-12) {
        best = v
        bestAssign = assign.slice()
      }
      return
    }
    for (const r of needRoles) {
      const apt = aptitude(presets[i], r)
      if (apt <= 0) continue
      const add = apt * officialBonus(presets[i], r)
      assign[i] = r
      covered.set(r, (covered.get(r) ?? 0) + add)
      rec(i + 1)
      covered.set(r, (covered.get(r) ?? 0) - add)
    }
    assign[i] = presets[i].role
    rec(i + 1)
  }
  rec(0)
  const out = { coverage: totalNeed > 0 ? Math.min(1, best / totalNeed) : 1, assignment: bestAssign }
  if (COVERAGE_MEMO.size > 100_000) COVERAGE_MEMO.clear()
  COVERAGE_MEMO.set(key, out)
  return { coverage: out.coverage, assignment: out.assignment.slice() }
}

/**
 * Prior d'une équipe (voir l'en-tête). `breeds` (facultatif) : données des classes pour les notes officielles.
 */
export function teamPrior(presets: readonly Preset[], needs: Partial<Record<RoleId, number>> = VORTEX_ROLE_NEEDS, breeds?: (id: number) => BreedData | undefined): TeamPrior {
  const penalties: string[] = []
  const byClass = new Map<number, number>()
  for (const p of presets) byClass.set(p.breedId, (byClass.get(p.breedId) ?? 0) + 1)
  for (const [b, n] of byClass) if (n > 2) penalties.push(`classe ${b} ×${n}`)

  const { coverage, assignment: bestAssign } = coverageOf(presets, needs, breeds)

  let links = 0
  for (let i = 0; i < presets.length; i++) {
    for (let j = i + 1; j < presets.length; j++) links += SYNERGY_LINKS[synergyKey(presets[i].breedId, presets[j].breedId)] ?? 0
  }
  const synergy = Math.min(1, links / 12)
  const breedSet = new Set(presets.map(p => p.breedId))
  const cited = CITED_COMPOSITIONS.filter(c => c.breeds.every(b => breedSet.has(b))).map(c => c.label)
  const arch = archetypeOf(presets)
  const control = presets.some(p => ['mpLock', 'apLock', 'placer'].includes(p.role) || ['mpLock', 'apLock', 'placer'].includes(p.secondaryRole ?? ''))
  if (!control) penalties.push('ni contrôle ni placeur')
  if (!arch.healer) penalties.push('poison des Harpilles sans soigneur')
  let score = coverage + 0.15 * synergy + 0.05 * cited.length
  if (!control) score -= 0.15
  if (!arch.healer) score -= 0.05
  if (penalties.some(p => p.startsWith('classe'))) score -= 1
  return { score, coverage, assignment: bestAssign, synergy, cited, penalties, archetype: arch }
}
