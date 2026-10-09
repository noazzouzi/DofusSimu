/**
 * Cible du proxy de stuff pour l'Œil de Vortex (docs/reports/vortex-stuffs.md) — profil des dégâts reçus MESURÉ en
 * combat et profils d'exposants (équilibré / défensif / offensif).
 *
 * Mix des cibles (DPT) : `VORTEX_TARGET_MIX` (composition des 5 vagues à 4 joueurs + Vortex).
 *
 * Mix des monstres qui frappent (EHP, `VORTEX_INCOMING_MIX`) : poids d'EXPOSITION calibrés sur les dégâts subis par
 * l'équipe méta (`cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu`, stuffs du preset, IA `fast`,
 * instantané `base-stuff-cp5`, 32 combats `masterSeed` 21) : poids(m) ∝ dégâts subis de m / dégâts par tour prévus par
 * le proxy pour m (somme sur les 4 personnages, hors dégâts de poussée, non modélisés). Dégâts subis mesurés (moyenne par
 * combat, 31 900 au total) : Harpille 15 200 (48 % : poison Eau 19 %, Superfidie Feu 15 %, Tirs optiques Neutre 14 %),
 * Brabuzar 4 950 (dont 1 730 de poussée), Buboxor 4 780 (Air 9 %, Eau 6 %), Méjaire 3 290, Ikargn 2 500, Vortex 710
 * (phase 1 : invulnérable, ne frappe que par « En temps et en heure »). Le mix des cibles, lui, pondérait le Vortex à
 * 5,7 (0,3 × 19) et ses sorts de phase 2 faisaient 33 % des dégâts reçus prévus : l'EHP valorisait les mauvaises
 * résistances (Air/Feu du Vortex au lieu de l'Eau du poison des Harpilles).
 *
 * Itération 2 (`VORTEX_INCOMING_MIX`, en vigueur) : même calibrage sur les combats de l'équipe aux stuffs optimisés
 * par l'itération 1 (instantané snap-1, 32 combats `masterSeed` 21, profil équilibré) — l'équipe survit ≈ 20 tours au
 * lieu de 14, les vagues tardives pèsent davantage : Brabuzar 1,77 → 3,16, Ikargn 0,70 → 1,01. L'itération 1 reste
 * exportée (`VORTEX_INCOMING_MIX_R1`).
 *
 * Poussée (`VORTEX_PUSH`) : les collisions des Brabuzars font 18 % des dégâts subis dans ces combats (8 360 par combat,
 * premier poste devant le poison des Harpilles) ; tous les monstres sont niveau 212 sans Dommages Poussée ⇒ dégâts ∝
 * (106 + 32 − RePou) : 100 de Résistance Poussée retire 72 % de ces dégâts. Part sans défense : 0,171 des dégâts reçus
 * sans défense (itération 1 : 0,047, combats plus courts).
 *
 * Profils d'exposants (rôle → (a, b, c) de `ROLE_EXPONENTS`, ajustés par `applyProfile`, profiles.ts) :
 *  - `balanced` : exposants du rôle ;
 *  - `defensive` : a − 0,2, b + 0,2 (les morts commencent au tour ≈ 10 : survie d'abord) ;
 *  - `offensive` : a + 0,15, b − 0,15.
 * PO visée : 6 pour un personnage à distance (rôle autre que tueur au contact) — la carte du Vortex est grande et les
 * Harpilles/Méjaires frappent à 5-7 cases ; sinon la règle du proxy (5 si la rotation a un sort à portée modifiable).
 */
import type { RoleId } from '../../ai/types'
import { VORTEX_TARGET_MIX } from '../../dungeons/generic/dummy'
import { applyProfile, EXPONENT_PROFILES, type ExponentProfile } from './profiles'
import { ROLE_EXPONENTS, type ProxyOptions, type ProxyPushModel, type ProxyTarget } from './proxy'

const IKARGN = 3834
const VORTEX = 3835
const MEJAIRE = 3836
const HARPILLE = 3837
const BUBOXOR = 3838
const BRABUZAR = 3839

/** Monstres qui frappent au Vortex, itération 1 (stuffs des presets ; voir l'en-tête ; Harpille ramenée à 4). */
export const VORTEX_INCOMING_MIX_R1: readonly ProxyTarget[] = [
  { monsterId: HARPILLE, weight: 4 },
  { monsterId: MEJAIRE, weight: 1.84 },
  { monsterId: BRABUZAR, weight: 1.77 },
  { monsterId: BUBOXOR, weight: 1.7 },
  { monsterId: IKARGN, weight: 0.7 },
  { monsterId: VORTEX, weight: 0.17 },
]

/** Monstres qui frappent au Vortex, itération 2 (stuffs optimisés, en vigueur ; voir l'en-tête ; Harpille = 4). */
export const VORTEX_INCOMING_MIX: readonly ProxyTarget[] = [
  { monsterId: HARPILLE, weight: 4 },
  { monsterId: MEJAIRE, weight: 1.91 },
  { monsterId: BRABUZAR, weight: 3.16 },
  { monsterId: BUBOXOR, weight: 1.69 },
  { monsterId: IKARGN, weight: 1.01 },
  { monsterId: VORTEX, weight: 0.19 },
]

/** Collisions reçues au Vortex (voir l'en-tête) : monstres niveau 212, 0 Dommages Poussée ⇒ bonus 106 + 32. */
export const VORTEX_PUSH: ProxyPushModel = { share: 0.171, bonus: 138 }

/** Parts mesurées des dégâts subis par élément (0 neutre … 4 air, −1 poussée), mêmes combats que le mix. */
export const VORTEX_MEASURED_INCOMING_SHARES: Readonly<Record<string, number>> = {
  neutral: 0.239,
  earth: 0.084,
  fire: 0.205,
  water: 0.31,
  air: 0.101,
  push: 0.061,
}

/** Profils d'exposants du Vortex (= profils communs, profiles.ts). */
export type VortexProfile = ExponentProfile
export const VORTEX_PROFILES: readonly VortexProfile[] = EXPONENT_PROFILES

/** Rôles « au contact » (pas de PO visée à 6). */
const MELEE_ROLES: ReadonlySet<RoleId> = new Set<RoleId>(['tank'])

export interface VortexProxyOptions {
  profile?: VortexProfile
  /** Ignorer les collisions (comparaison avec l'itération 1). */
  noPush?: boolean
  /** Mix des monstres qui frappent (défaut `VORTEX_INCOMING_MIX`). */
  incoming?: readonly ProxyTarget[]
  /** Personnage au contact (Iop, tank…) : pas de PO visée à 6. */
  melee?: boolean
}

/** Options du proxy pour un personnage au Vortex (voir l'en-tête). */
export function vortexProxyOptions(role: RoleId, opts: VortexProxyOptions = {}): ProxyOptions {
  const melee = opts.melee ?? MELEE_ROLES.has(role)
  return {
    targets: VORTEX_TARGET_MIX,
    incoming: opts.incoming ?? VORTEX_INCOMING_MIX,
    ...(opts.noPush ? {} : { incomingPush: VORTEX_PUSH }),
    exponents: applyProfile(ROLE_EXPONENTS[role], opts.profile ?? 'balanced'),
    ...(melee ? {} : { rangeNeed: 6 }),
  }
}
