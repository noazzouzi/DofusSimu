/**
 * Cible du proxy de stuff construite à partir d'une fiche de boss (docs/design/theorycraft.md §1.4).
 *
 * `bossProxyOptions(profile, opts)` traduit un `BossProfile` en `ProxyOptions` EXPLICITES (`strictTargets` : jamais le
 * mix du Vortex par défaut, proxy.ts) :
 *  - `targets` (DPT) : une entrée par phase où le boss est attaquable, pondérée par le poids de la phase, avec les
 *    caractéristiques effectives du boss (sort de départ, fiche manuelle) et les résistances de la phase. Une phase
 *    vulnérable seulement en mêlée met `rangedResPct` à 100 (aucun dégât à distance) et inversement : le sac à dos du
 *    DPT choisit alors de lui-même les coups du bon type (un sort lançable au contact et à distance y compte dans le
 *    meilleur des deux, hits.ts). Si aucune phase n'est attaquable, toutes les phases servent (hypothèse signalée :
 *    invulnérabilité supposée levée par la mécanique).
 *  - `incoming` (dégâts reçus, EHP) : une entrée par phase qui inflige des dégâts, avec ses états (les sorts de phase
 *    deviennent lançables), le poids de la phase, les PV « à mi-vie » de la fiche (`BOSS_HP_SHARE` : lignes en % des PV
 *    du lanceur) et sans les sorts exclus ou positionnels de la fiche manuelle — les dégâts du pic de la fiche ; plus
 *    les adds de la fiche manuelle, chacun d'exposition `ADD_EXPOSURE` × nombre (hypothèse signalée).
 *  - `theoryTable` : table DPT du theorycraft (hits.ts : coups au contact ou à distance pour le personnage, conventions
 *    de la fiche pour les sorts du boss) ; `contact` pour un personnage joué au contact (à égalité de la cible, un sort
 *    lançable au contact et à distance compte en mêlée : ses % dommages mêlée comptent).
 *  - exposants du rôle ajustés par le profil (`applyProfile`) ; utilité d'un retraitiste ANNULÉE (c = 0) quand le boss
 *    punit ce retrait ou n'a pas la réserve visée (même règle que l'axe Contrôle de classes.ts, avertissement) ;
 *    `rangeNeed` 6 à distance, 0 au contact.
 *
 * Règles communes à `classes` et `stuff` :
 *  - `playsMelee` : un personnage est joué au contact si le boss n'est attaquable qu'au contact (`meleeOnlyBoss`) ou si
 *    son preset est un preset de mêlée (`MELEE_PRESET`, liste de la campagne des stuffs), sauf choix explicite ;
 *  - `removalVoid` : réserve (PM, PA) dont le retrait ne compte pas contre ce boss (puni, ou réserve absente) ;
 *  - `incomingCoherence` : tour reçu du proxy SANS défense comparé au pic de la fiche (mêmes phases, mêmes poids, PV de
 *    référence de la fiche) ; au-delà de `INCOMING_GAP`, avertissement chiffré (les deux modèles comptent encore
 *    autrement les sous-sorts lancés par la cible, les branches selon la cible et les poisons portés par un sous-sort
 *    déclenché).
 *
 * Pur (aucun accès fichier) ; n'importe que des types du proxy (les exposants viennent de profiles.ts, sans dépendance
 * au Vortex).
 */
import type { RoleId } from '../ai/types'
import { ELEMENT_RES_PCT, ELEMENTS, type Stats } from '../core/types'
import { applyProfile, ROLE_EXPONENTS, type ExponentProfile } from '../optimizer/stuff/profiles'
import type { ProxyOptions, ProxyTarget } from '../optimizer/stuff/proxy'
import { BOSS_HP_SHARE, DEFAULT_REF_HP } from './bossProfile'
import type { BossPhaseProfile, BossProfile } from './types'

/** Exposition d'un add par rapport au boss (part des tours d'attaque, par monstre) — hypothèse par défaut. */
export const ADD_EXPOSURE = 0.5
/** PO voulue contre un boss joué à distance (cartes de boss usuelles). */
export const DEFAULT_RANGE_NEED = 6
/** Écart relatif toléré entre le tour reçu du proxy sans défense et le pic de la fiche (au-delà : avertissement). */
export const INCOMING_GAP = 0.2

/**
 * Presets joués au contact : PO non exigée (même liste que `MELEE_PRESET` de src/optimizer/builds.ts, campagne des
 * stuffs ; recopiée pour ne pas tirer l'optimiseur de builds).
 */
export const MELEE_PRESET = /^(iop_terre|ouginak|sacrieur|zobal|feca_protecteur|pandawa_saoul)/

/** Le boss n'est-il attaquable qu'au contact (toutes les phases attaquables « mêlée ») ? */
export function meleeOnlyBoss(profile: BossProfile): boolean {
  const att = profile.phases.filter(p => p.vulnerable !== false && p.weight > 0)
  return att.length > 0 && att.every(p => p.vulnerable === 'melee')
}

/**
 * Personnage joué au contact (PO non exigée) : choix explicite `override`, sinon boss attaquable seulement au contact
 * ou preset de mêlée (`presetId` : preset de base, `extends` d'un preset dérivé). Règle unique de `classes` et `stuff`.
 */
export function playsMelee(profile: BossProfile, presetId: string, override?: boolean): boolean {
  return override ?? (meleeOnlyBoss(profile) || MELEE_PRESET.test(presetId))
}

/** Mécanique « retrait puni » qui vise cette réserve. */
export function removalPunished(profile: BossProfile, tag: 'mp-removal' | 'ap-removal'): boolean {
  return profile.mechanics.some(m => m.kind === 'punished-removal' && (m.punishes?.length ? m.punishes : ['mp-removal', 'ap-removal']).includes(tag))
}

/** Raison pour laquelle le retrait de cette réserve ne compte pas contre ce boss (puni ou réserve absente), sinon undefined. */
export function removalVoid(profile: BossProfile, pool: 'mp' | 'ap'): string | undefined {
  if (removalPunished(profile, pool === 'mp' ? 'mp-removal' : 'ap-removal')) return `le boss punit le retrait de ${pool === 'mp' ? 'PM' : 'PA'}`
  if ((pool === 'mp' ? profile.mp : profile.ap) <= 0) return `le boss n'a pas de ${pool === 'mp' ? 'PM' : 'PA'}`
  return undefined
}

/** Réserve visée par l'utilité d'un rôle de retrait. */
const REMOVAL_ROLE: Partial<Record<RoleId, 'mp' | 'ap'>> = { mpLock: 'mp', apLock: 'ap' }

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
  /** Avertissements (utilité de rôle ignorée…). */
  warnings: string[]
  /** Phases du boss des premières entrées de `options.incoming` (dans l'ordre ; les adds suivent) — `incomingCoherence`. */
  incomingPhases: string[]
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
  const warnings: string[] = []
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

  // Dégâts reçus : mêmes sorts et mêmes PV du boss que le pic de la fiche (sorts exclus ou positionnels retirés, mi-vie).
  const removed = [...new Set([...(profile.overrides?.excludeSpells ?? []), ...(profile.overrides?.positionalSpells ?? [])])]
  const hitting = profile.phases.filter(p => p.weight > 0 && p.sustainedPerTurn > 0)
  const incoming: ProxyTarget[] = hitting.length
    ? hitting.map(p => ({ ...entry(p), hpShare: BOSS_HP_SHARE, ...(removed.length ? { excludeSpells: removed.slice() } : {}) }))
    : targets.slice()
  if (!hitting.length) assumptions.push('Aucun dégât calculable du boss : PV effectifs sans pression offensive réelle (plafond du proxy).')

  const adds = opts.includeAdds === false ? [] : profile.overrides?.adds ?? []
  const exposure = opts.addExposure ?? ADD_EXPOSURE
  for (const add of adds) {
    incoming.push({ monsterId: add.monsterId, weight: exposure * add.count, ...(add.grade ? { grade: add.grade } : {}) })
  }
  if (adds.length) assumptions.push(`Adds de la fiche comptés dans les dégâts reçus, exposition ${exposure} par monstre par rapport au boss.`)

  let exponents = applyProfile(ROLE_EXPONENTS[opts.role], opts.profile ?? 'balanced')
  const pool = REMOVAL_ROLE[opts.role]
  const voidWhy = pool && removalVoid(profile, pool)
  if (voidWhy && exponents.c > 0) {
    exponents = { ...exponents, c: 0 }
    warnings.push(`Retrait ${pool === 'mp' ? 'PM' : 'PA'} sans valeur contre ce boss (${voidWhy}) : utilité du rôle ignorée dans l'objectif (c = 0, comme l'axe Contrôle de la comparaison des classes).`)
  }

  const options: ProxyOptions = {
    targets,
    incoming,
    strictTargets: true,
    grade,
    exponents,
    rangeNeed: opts.melee ? 0 : DEFAULT_RANGE_NEED,
    theoryTable: true,
    ...(opts.melee ? { contact: true } : {}),
  }
  return { options, assumptions, warnings, incomingPhases: hitting.map(p => p.id) }
}

const fmt = (v: number, digits = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits })

/** PV de référence d'un joueur de la fiche (fiche détaillée `refHp`), sinon le défaut. */
export function refHpOf(profile: BossProfile): number {
  return (profile as { refHp?: number }).refHp ?? DEFAULT_REF_HP
}

/**
 * Cohérence des dégâts reçus (voir l'en-tête) : `undefended` = tour reçu du proxy SANS défense par entrée de
 * `options.incoming` (`ProxyContext.incomingUndefended`, aux PV de référence de la fiche `refHpOf`), comparé au pic de
 * la fiche des mêmes phases, mêmes poids (adds exclus). undefined : rien à comparer (aucune phase qui frappe).
 */
export function incomingCoherence(
  profile: BossProfile,
  target: BossTarget,
  undefended: readonly number[],
): { fiche: number; proxy: number; ratio: number; warning?: string } | undefined {
  const incoming = target.options.incoming ?? []
  let fiche = 0
  let proxy = 0
  target.incomingPhases.forEach((id, i) => {
    const phase = profile.phases.find(p => p.id === id)
    if (!phase || !incoming[i]) return
    fiche += incoming[i].weight * phase.peakPerTurn
    proxy += incoming[i].weight * (undefended[i] ?? 0)
  })
  if (!(fiche > 0)) return undefined
  const ratio = proxy / fiche
  const warning =
    Math.abs(ratio - 1) > INCOMING_GAP
      ? `Dégâts reçus : le proxy de stuff (PV effectifs, dégâts reçus par tour) compte ${fmt(proxy)} par tour sans défense, contre ${fmt(fiche)} au pic de la fiche du boss (×${fmt(ratio, 2)} ; mêmes phases, joueur à 0 % de résistance) — sous-sorts lancés par la cible, branches selon la cible ou poisons déclenchés comptés autrement : PV effectifs à lire avec prudence.`
      : undefined
  return { fiche, proxy, ratio, ...(warning ? { warning } : {}) }
}
