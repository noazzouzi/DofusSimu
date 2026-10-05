/**
 * Rôles inférés et affectés (docs/design/ai.md §9.2) — WP2.
 *
 * `capabilities` mesure ce qu'un combattant sait faire contre les cibles de référence du scénario (DPT monocible et
 * de zone, burst, retraits PA/PM, placement, soins, boucliers, purge, désenvoûtement, invocations, tacle, fuite, PV
 * effectifs, portée, mobilité, initiative). Scores (dénominateurs du design recalibrés sur l'échelle des stuffs
 * THL simulés : un tueur fait ≈ 1 500-2 500 PVe/tour sur les monstres du Vortex) : killer = dptMono/1 500,
 * zoneDps = dptZone3/3 500, mpLock = mpRemoval/3, apLock = apRemoval/3 (espérance contre l'esquive des cibles de
 * référence), placer = sorts de placement/5, tank = (ehp/8 000)·(tacle/80), healer = soin/2 500, support =
 * buffs/2 000, summoner = min(4, invocations)/5 ; +10 % pour les rôles officiels de la classe (DofusDB `breedRoles`) ;
 * un rôle imposé par le preset (`Fighter.role` ∈ RoleId) est retenu comme principal.
 * `assignRoles` normalise chaque rôle par le meilleur score de l'équipe (avantage COMPARATIF : l'Enutrof est le
 * meilleur retireur de PM de l'équipe même si un Iop retire aussi des PM ; un score absolu < 0,25 est atténué), puis
 * maximise Σ besoin couvert × score par énumération (9ⁿ affectations, n ≤ 4 ; glouton au-delà) ; le second meilleur
 * score ≥ 0,6 × principal devient le rôle secondaire. Écart au design : normalisation relative ajoutée (les échelles
 * absolues des rôles ne sont pas comparables entre elles).
 *
 * Un rôle ne crée AUCUN objectif propre : il module quotas, priors de tactiques, w_inc (tank), U_role, termes de fin
 * de tour, éligibilité aux contrats de kill et départages.
 */
import { expectedApMpRemoved } from '../../damage/apmp'
import type { Fighter } from '../../engine/types'
import { hpEff, type PerceptionX } from '../core'
import type { AIView, CapabilityProfile, ReferenceTargets, RoleAssignment, RoleId } from '../types'
import { ROLE_IDS } from '../types'

/** Rôles officiels DofusDB (`breed.roles`) → rôles de l'IA. */
const OFFICIAL: Record<string, RoleId[]> = {
  'Dégâts': ['killer', 'zoneDps'],
  'Entrave': ['mpLock', 'apLock'],
  'Soins': ['healer'],
  'Amélioration': ['support'],
  'Placement': ['placer'],
  'Tank': ['tank'],
  'Protection': ['tank', 'support'],
  'Invocation': ['summoner'],
}

/** Besoins génériques (combats sans scénario). */
export const GENERIC_NEEDS: Partial<Record<RoleId, number>> = { killer: 2, healer: 1, zoneDps: 1, mpLock: 0.75, placer: 0.5, tank: 0.5, support: 0.25, summoner: 0.25, apLock: 0.25 }

/** Cibles de référence par défaut : ennemis visibles non statiques, poids égaux. */
export function defaultReferenceTargets(view: AIView): ReferenceTargets {
  const enemies = view.visible().filter(f => f.team !== view.team && f.tags.static !== true && f.tags.canPlay !== false)
  return { targets: enemies.map(f => ({ fighter: f, weight: 1 / Math.max(1, enemies.length) })) }
}

/** PA disponibles à un tour (12 au plus pour les estimations). */
function apOf(f: Fighter): number {
  return Math.max(1, Math.min(12, f.stats.ap))
}

/** Capacités d'un combattant contre les cibles de référence (§9.2). */
export function capabilities(view: AIView, f: Fighter, p: PerceptionX, ref: ReferenceTargets): CapabilityProfile {
  const profs = p.profiles.ofFighter(f)
  const ap = apOf(f)
  const targets = ref.targets.length ? ref.targets : []
  const wsum = targets.reduce((a, t) => a + t.weight, 0) || 1
  // DPT monocible (tour complet, sac à dos) et meilleur lancer.
  let dptMono = 0
  let burst1 = 0
  let dptZone3 = 0
  for (const { fighter: t, weight } of targets) {
    const w = weight / wsum
    dptMono += w * p.dpt.dpt(f, t, ap)
    let best = 0
    let zone = 0
    for (let i = 0; i < profs.length; i++) {
      const pr = profs[i]
      if (!pr.damage.length || pr.unsupported) continue
      const m = p.dpt.perCast(f, i, t).mean
      if (m > best) best = m
      if (pr.zoneRadius >= 1) {
        const casts = Math.max(1, Math.min(pr.castsPerTurn > 0 ? pr.castsPerTurn : 9, Math.floor(ap / Math.max(1, pr.apCost))))
        zone = Math.max(zone, m * 2.4 * casts)
      }
    }
    burst1 += w * best
    dptZone3 += w * zone
  }
  dptZone3 = Math.max(dptZone3, dptMono)
  // Retraits PA/PM par tour (meilleur rapport retrait/PA, sac à dos glouton) : espérance contre l'esquive des cibles
  // de référence (formule du jeu, points de la cible), lancers multiples cumulés.
  const refPts = (pool: 'ap' | 'mp'): number => {
    let pts = 0
    for (const { fighter: t, weight } of targets) pts += (weight / wsum) * Math.max(0, t.stats[pool])
    return targets.length ? pts : pool === 'ap' ? 12 : 6
  }
  const refParry = (pool: 'ap' | 'mp'): number => {
    let v = 0
    for (const { fighter: t, weight } of targets) v += (weight / wsum) * (pool === 'ap' ? t.stats.apParry : t.stats.mpParry)
    return v
  }
  const removal = (pool: 'ap' | 'mp'): number => {
    const pts = Math.max(1, Math.round(refPts(pool)))
    const parry = refParry(pool)
    const red = pool === 'ap' ? f.stats.apReduction : f.stats.mpReduction
    const opts: { per: number; cost: number; casts: number }[] = []
    for (const pr of profs) {
      if (pr.unsupported) continue
      let v = 0
      for (const r of pr.removals) {
        if (r.pool !== pool || r.delay > 0 || !r.sides.enemy) continue
        v += r.dodgeable ? expectedApMpRemoved(red, parry, pts, pts, Math.round(r.value)) : Math.min(pts, r.value)
      }
      if (v > 0) opts.push({ per: v, cost: Math.max(1, pr.apCost), casts: pr.castsPerTurn > 0 ? pr.castsPerTurn : 2 })
    }
    opts.sort((a, b) => b.per / b.cost - a.per / a.cost)
    let left = ap
    let total = 0
    for (const o of opts) {
      const n = Math.min(o.casts, Math.floor(left / o.cost))
      total += n * o.per
      left -= n * o.cost
    }
    return total
  }
  let placement = 0
  let heal = 0
  let shield = 0
  let summons = 0
  let cleanse = false
  let dispel = false
  let maxRange = 0
  let mobility = Math.max(0, f.stats.mp)
  for (let i = 0; i < profs.length; i++) {
    const pr = profs[i]
    if (pr.unsupported) continue
    if (pr.apCost <= 3 && pr.moves.some(m => !m.onCaster || m.kind === 'swap')) placement++
    if (pr.moves.some(m => m.onCaster && (m.kind === 'teleport' || m.kind === 'swap'))) mobility += 2
    for (const h of pr.heals) {
      if (!h.sides.ally && !h.sides.self) continue
      const base = (h.min + h.max) / 2
      const amount = h.kind === 'pctMax' ? (base * f.maxHp) / 100 : h.kind === 'fixed' ? base : base * (1 + Math.max(0, f.stats.intelligence) / 100)
      heal = Math.max(heal, amount * Math.max(1, Math.floor(ap / Math.max(1, pr.apCost))) * h.p)
      cleanse = true
    }
    for (const sh of pr.shields) {
      if (!sh.sides.ally && !sh.sides.self) continue
      const amount = sh.kind === 'pctLevel' ? (sh.value * f.level) / 100 : sh.kind === 'pctMaxHp' ? (sh.value * f.maxHp) / 100 : sh.value
      shield = Math.max(shield, amount)
    }
    if (pr.removesStates) dispel = true
    if (pr.summonLines.length) summons++
    if (pr.damage.length) maxRange = Math.max(maxRange, pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, f.stats.range) : 0))
  }
  const st = f.stats
  const res = (st.neutralResPct + st.earthResPct + st.fireResPct + st.waterResPct + st.airResPct) / 500
  const ehp = hpEff(f) / Math.max(0.1, 1 - Math.min(0.9, Math.max(-1, res)))
  return {
    fighterId: f.id,
    dptMono, dptZone3, burst1,
    mpRemoval: removal('mp'), apRemoval: removal('ap'),
    placement: Math.min(6, placement), heal, shield, cleanse, dispel, summons,
    tackle: st.tackleBlock, evade: st.tackleEvade, ehp, maxRange, mobility, initiative: st.initiative,
  }
}

/** Valeur de soutien (buffs alliés) d'un profil de capacités : approximation du design (buffValue/1 000). */
function supportValue(c: CapabilityProfile, view: AIView, p: PerceptionX): number {
  const f = view.fight.fighters[c.fighterId]
  if (!f) return 0
  let buff = 0
  for (const pr of p.profiles.ofFighter(f)) if (!pr.unsupported && pr.allyBuff) buff += 300
  return buff + 0.5 * c.shield
}

/** Scores de rôles d'un combattant (§9.2), +10 % pour les rôles officiels de la classe. */
export function roleScores(view: AIView, f: Fighter, c: CapabilityProfile, p: PerceptionX): Record<RoleId, number> {
  const sc: Record<RoleId, number> = {
    killer: c.dptMono / 1500,
    zoneDps: c.dptZone3 / 3500,
    mpLock: c.mpRemoval / 3,
    apLock: c.apRemoval / 3,
    placer: c.placement / 5,
    tank: (c.ehp / 8000) * (c.tackle / 80),
    healer: c.heal / 2500,
    support: supportValue(c, view, p) / 2000,
    summoner: Math.min(4, c.summons) / 5,
  }
  const breed = f.breedId !== undefined ? view.engine.data.breed(f.breedId) : undefined
  for (const r of breed?.roles ?? []) for (const id of OFFICIAL[r] ?? []) sc[id] *= 1.1
  return sc
}

/** Le rôle imposé par le preset (`Fighter.role` ∈ RoleId), s'il existe. */
export function imposedRole(f: Fighter): RoleId | undefined {
  const r = f.role as RoleId | undefined
  return r && (ROLE_IDS as readonly string[]).includes(r) ? r : undefined
}

/**
 * Affectation des rôles (§9.2) : maximise Σ_m score(m, rôle(m))·poids, où le k-ième porteur d'un rôle r compte
 * clamp(besoin_r − (k − 1), 0, 1) (0,1 au-delà) ; énumération exhaustive pour ≤ 4 membres, gloutonne au-delà.
 * `prior` (rôles imposés) fixe le rôle principal des membres concernés.
 */
export function assignRoles(team: Fighter[], scores: Record<RoleId, number>[], needs: Partial<Record<RoleId, number>>,
                            prior?: Map<number, RoleId>): Map<number, RoleAssignment> {
  const n = team.length
  const R = ROLE_IDS.length
  const fixed = team.map(f => prior?.get(f.id))
  // Avantage comparatif : chaque rôle normalisé par le meilleur score de l'équipe ; score absolu faible atténué.
  const absScores = scores
  scores = scores.map(sc => {
    const out = {} as Record<RoleId, number>
    for (const r of ROLE_IDS) {
      let max = 0
      for (const x of absScores) max = Math.max(max, x[r])
      const raw = sc[r]
      out[r] = max > 0 ? (raw / max) * Math.min(1, raw / 0.25) : 0
    }
    return out
  })
  const weight = (role: RoleId, k: number): number => {
    const need = needs[role] ?? 0
    const w = Math.max(0, Math.min(1, need - k))
    return w > 0 ? w : 0.1
  }
  const value = (assign: number[]): number => {
    const count = new Array<number>(R).fill(0)
    // Ordre stable : les meilleurs scores d'un rôle comptent en premier.
    const idx = assign.map((r, m) => ({ r, m })).sort((a, b) => scores[b.m][ROLE_IDS[b.r]] - scores[a.m][ROLE_IDS[a.r]] || a.m - b.m)
    let v = 0
    for (const { r, m } of idx) {
      v += scores[m][ROLE_IDS[r]] * weight(ROLE_IDS[r], count[r])
      count[r]++
    }
    return v
  }
  let best: number[] = []
  if (n <= 4) {
    let bestV = -Infinity
    const cur = new Array<number>(n).fill(0)
    const rec = (m: number): void => {
      if (m === n) {
        const v = value(cur)
        if (v > bestV + 1e-12) {
          bestV = v
          best = cur.slice()
        }
        return
      }
      const f = fixed[m]
      if (f) {
        cur[m] = ROLE_IDS.indexOf(f)
        rec(m + 1)
        return
      }
      for (let r = 0; r < R; r++) {
        cur[m] = r
        rec(m + 1)
      }
    }
    rec(0)
  } else {
    const count = new Array<number>(R).fill(0)
    best = new Array<number>(n).fill(0)
    const orderM = team.map((_, m) => m).sort((a, b) => Math.max(...Object.values(scores[b])) - Math.max(...Object.values(scores[a])) || a - b)
    for (const m of orderM) {
      let br = 0
      let bv = -Infinity
      const f = fixed[m]
      for (let r = 0; r < R; r++) {
        if (f && ROLE_IDS[r] !== f) continue
        const v = scores[m][ROLE_IDS[r]] * weight(ROLE_IDS[r], count[r])
        if (v > bv) {
          bv = v
          br = r
        }
      }
      best[m] = br
      count[br]++
    }
  }
  const out = new Map<number, RoleAssignment>()
  team.forEach((f, m) => {
    const primary = ROLE_IDS[best[m] ?? 0]
    const sc = scores[m]
    let secondary: RoleId | undefined
    let sv = -Infinity
    for (const r of ROLE_IDS) {
      if (r === primary) continue
      if (sc[r] > sv) {
        sv = sc[r]
        secondary = r
      }
    }
    const a: RoleAssignment = { primary, scores: { ...sc } }
    if (secondary && sv >= 0.6 * sc[primary] && sv > 0) a.secondary = secondary
    out.set(f.id, a)
  })
  return out
}
