/**
 * Dommages de poussée (collision) — docs/research/formulas.md §10 (patch 2.17, client D2, port D3).
 *
 *   dégâts(i) = trunc((niveau/2 + DoPou − RePou + 32) × casesRestantes / (4 × 2^i)), au moins 0
 *
 * `i` = rang dans la chaîne de collision (0 = entité poussée, 1, 2… = entités percutées derrière elle, chacune
 * avec SES résistances poussée). Poussée en direction « cardinale » de la grille : cases restantes × 2.
 * Non boostables : ni carac, ni puissance, ni % dommages, ni résistances élémentaires, ni armure.
 * Une invocation utilise le niveau de son invocateur (à fournir dans `casterLevel`).
 */

export interface PushDamageInput {
  casterLevel: number
  /** Dommages Poussée du lanceur (carac 84). */
  pushDamage: number
  /** Résistances Poussée de l'entité percutée (carac 85). */
  pushRes: number
  /** Force de poussée non consommée (cases). */
  remainingCells: number
  /** Rang dans la chaîne de collision (0 = entité poussée). */
  chainIndex?: number
  /** Direction cardinale de la grille : la force restante compte double. */
  cardinal?: boolean
  /**
   * Arrondi du niveau : `dofus2` (défaut, formule officielle du patch 2.17 / client AS3 : niveau/2 réel) ou
   * `dofus3` (port Haxe : `floor(niveau/2)` puis division entière). Ne diffèrent que pour un niveau impair.
   */
  variant?: 'dofus2' | 'dofus3'
  /** % Dommages Poussée (carac 158, Dofus 3) : `× (100 + x) / 100` — INCERTAIN. */
  pushDamagePct?: number
  /** Dommages subis de la cible, seulement si le buff s'applique à la poussée (instantané ou déclencheur poussée). */
  sustainedPct?: number
}

export function pushDamage(input: PushDamageInput): number {
  const cells = input.remainingCells
  if (!(cells > 0)) return 0
  const force = input.cardinal ? cells * 2 : cells
  const divisor = 4 * 2 ** (input.chainIndex ?? 0)
  const bonus = input.pushDamage - input.pushRes + 32
  let dmg =
    input.variant === 'dofus3'
      ? Math.trunc((force * (Math.floor(input.casterLevel / 2) + bonus)) / divisor)
      : Math.trunc(((input.casterLevel / 2 + bonus) * force) / divisor)
  if (dmg <= 0) return 0
  if (input.pushDamagePct) dmg = Math.trunc((dmg * (100 + input.pushDamagePct)) / 100)
  if (input.sustainedPct !== undefined) dmg = Math.trunc((dmg * input.sustainedPct) / 100)
  return dmg > 0 ? dmg : 0
}
