/**
 * Profils d'exposants du proxy de stuff (J = DPT^a · EHP^b · (1 + c·UTIL), proxy.ts) — extraits de
 * `vortexProxyOptions` (vortex.ts) pour servir à toute cible (Vortex, boss du theorycraft, docs/design/theorycraft.md
 * §1.4) :
 *  - `balanced` : exposants inchangés (ceux du rôle, `ROLE_EXPONENTS`) ;
 *  - `defensive` : a − 0,2, b + 0,2 (survie d'abord) ;
 *  - `offensive` : a + 0,15, b − 0,15.
 * a et b restent ≥ 0,05 ; c n'est jamais modifié. Les décalages viennent des réglages du Vortex
 * (docs/reports/vortex-stuffs.md) : la sortie de `vortexProxyOptions` est inchangée par l'extraction.
 */
import type { RoleId } from '../../ai/types'

export interface ProxyExponents {
  a: number
  b: number
  c: number
}

/** Exposants (a, b, c) de J par rôle (§15.4). */
export const ROLE_EXPONENTS: Readonly<Record<RoleId, ProxyExponents>> = {
  killer: { a: 0.7, b: 0.3, c: 0 },
  zoneDps: { a: 0.7, b: 0.3, c: 0 },
  tank: { a: 0.2, b: 0.8, c: 0.2 },
  mpLock: { a: 0.3, b: 0.4, c: 1 },
  apLock: { a: 0.3, b: 0.4, c: 1 },
  healer: { a: 0.2, b: 0.5, c: 1 },
  // Non chiffrés par le design : compromis documentés.
  placer: { a: 0.4, b: 0.5, c: 0.5 },
  support: { a: 0.3, b: 0.5, c: 1 },
  summoner: { a: 0.6, b: 0.4, c: 0.3 },
}

export type ExponentProfile = 'balanced' | 'defensive' | 'offensive'
export const EXPONENT_PROFILES: readonly ExponentProfile[] = ['balanced', 'defensive', 'offensive']

/** Décalage de `a` (et opposé de `b`) par profil. */
const PROFILE_SHIFT: Readonly<Record<ExponentProfile, number>> = { balanced: 0, defensive: -0.2, offensive: 0.15 }

/** Plancher de a et b après décalage. */
const MIN_EXPONENT = 0.05

/** Exposants ajustés selon le profil (voir l'en-tête) ; nouvel objet, `exponents` intact. */
export function applyProfile(exponents: ProxyExponents, profile: ExponentProfile = 'balanced'): ProxyExponents {
  if (!EXPONENT_PROFILES.includes(profile)) throw new Error(`Profil d'exposants inconnu : « ${profile} » (connus : ${EXPONENT_PROFILES.join(', ')})`)
  const da = PROFILE_SHIFT[profile]
  return { a: Math.max(MIN_EXPONENT, exponents.a + da), b: Math.max(MIN_EXPONENT, exponents.b - da), c: exponents.c }
}
