/**
 * Cible du proxy de stuff construite à partir d'une fiche de boss (docs/design/theorycraft.md §1.4).
 *
 * `bossProxyOptions(profile, opts)` traduit un `BossProfile` en `ProxyOptions` EXPLICITES (`strictTargets` : jamais le
 * mix du Vortex par défaut, proxy.ts) :
 *  - `targets` (DPT) : une entrée par phase où le boss est attaquable, pondérée par le poids de la phase, avec les
 *    caractéristiques effectives du boss (sort de départ, fiche manuelle) et les résistances de la phase. Une phase
 *    vulnérable seulement en mêlée met `rangedResPct` à 100 (aucun dégât à distance) et inversement : le sac à dos du
 *    DPT choisit alors de lui-même les sorts du bon type. Si aucune phase n'est attaquable, toutes les phases servent
 *    (hypothèse signalée : invulnérabilité supposée levée par la mécanique).
 *  - `incoming` (dégâts reçus, EHP) : une entrée par phase qui inflige des dégâts, avec ses états (les sorts de phase
 *    deviennent lançables) et le poids de la phase ; plus les adds de la fiche manuelle, chacun d'exposition
 *    `ADD_EXPOSURE` × nombre (hypothèse signalée).
 *  - exposants du rôle ajustés par le profil (`applyProfile`) ; `rangeNeed` 6 à distance, 0 au contact.
 *
 * Pur (aucun accès fichier) ; n'importe que des types du proxy (les exposants viennent de profiles.ts, sans dépendance
 * au Vortex).
 */
import type { RoleId } from '../ai/types'
import { ELEMENT_RES_PCT, ELEMENTS, type Stats } from '../core/types'
import { applyProfile, ROLE_EXPONENTS, type ExponentProfile } from '../optimizer/stuff/profiles'
import type { ProxyOptions, ProxyTarget } from '../optimizer/stuff/proxy'
import type { BossPhaseProfile, BossProfile } from './types'

/** Exposition d'un add par rapport au boss (part des tours d'attaque, par monstre) — hypothèse par défaut. */
export const ADD_EXPOSURE = 0.5
/** PO voulue contre un boss joué à distance (cartes de boss usuelles). */
export const DEFAULT_RANGE_NEED = 6

export interface BossProxyOptions {
  /** Rôle du personnage (exposants de J). */
  role: RoleId
  /** Profil d'exposants (défaut équilibré). */
  profile?: ExponentProfile
  /** Personnage joué au contact (PO non exigée). */
  melee?: boolean
  /** Compter les adds de la fiche manuelle dans les dégâts reçus (défaut vrai). */
  includeAdds?: boolean
  /** Exposition d'un add (défaut `ADD_EXPOSURE`). */
  addExposure?: number
}

export interface BossTarget {
  options: ProxyOptions
  /** Hypothèses introduites par la traduction (à afficher avec celles du profil). */
  assumptions: string[]
}

/** Caractéristiques défensives (et offensives, pour les dégâts reçus) imposées au boss dans une phase. */
function phaseStats(profile: BossProfile, phase: BossPhaseProfile): Partial<Stats> {
  const s: Partial<Stats> = { ...profile.stats }
  for (const el of ELEMENTS) s[ELEMENT_RES_PCT[el]] = phase.resPct[el]
  if (phase.vulnerable === 'melee') s.rangedResPct = 100
  else if (phase.vulnerable === 'range') s.meleeResPct = 100
  return s
}

/** Traduit une fiche de boss en options explicites du proxy de stuff (voir l'en-tête). */
export function bossProxyOptions(profile: BossProfile, opts: BossProxyOptions): BossTarget {
  const assumptions: string[] = []
  const grade = profile.grade
  const entry = (phase: BossPhaseProfile): ProxyTarget => ({
    monsterId: profile.monsterId,
    weight: phase.weight,
    grade,
    stats: phaseStats(profile, phase),
    ...(phase.states.length ? { states: phase.states.slice() } : {}),
  })

  let attackable = profile.phases.filter(p => p.vulnerable !== false && p.weight > 0)
  if (!attackable.length) {
    attackable = profile.phases.filter(p => p.weight > 0)
    assumptions.push('Aucune phase attaquable dans les données : DPT calculé comme si l\'invulnérabilité était levée par la mécanique du boss.')
  }
  const targets = attackable.map(entry)

  const hitting = profile.phases.filter(p => p.weight > 0 && p.sustainedPerTurn > 0)
  const incoming: ProxyTarget[] = hitting.length ? hitting.map(entry) : targets.slice()
  if (!hitting.length) assumptions.push('Aucun dégât calculable du boss : PV effectifs sans pression offensive réelle (plafond du proxy).')

  const adds = opts.includeAdds === false ? [] : profile.overrides?.adds ?? []
  const exposure = opts.addExposure ?? ADD_EXPOSURE
  for (const add of adds) {
    incoming.push({ monsterId: add.monsterId, weight: exposure * add.count, ...(add.grade ? { grade: add.grade } : {}) })
  }
  if (adds.length) assumptions.push(`Adds de la fiche comptés dans les dégâts reçus, exposition ${exposure} par monstre par rapport au boss.`)

  const options: ProxyOptions = {
    targets,
    incoming,
    strictTargets: true,
    grade,
    exponents: applyProfile(ROLE_EXPONENTS[opts.role], opts.profile ?? 'balanced'),
    rangeNeed: opts.melee ? 0 : DEFAULT_RANGE_NEED,
  }
  return { options, assumptions }
}
