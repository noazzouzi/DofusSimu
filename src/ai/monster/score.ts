/**
 * Score des monstres en PVe (docs/design/ai.md §11.4 ; docs/research/monster-ai.md §8.4) — WP1.
 *
 * `scoreTransition` : différence AVANT (racine du pas) / APRÈS (clone simulé en 'average') d'un candidat :
 *
 *   Σ_e wDmg·v(e)·min(ΔPVeff_e, PVeff_e)          + Σ_{e tués} wKill·(κ·PVmax_e + menace_e)
 *   + Σ_e wAP·min(ΔPA_e, PA_e^next)·apWorth_e      + Σ_e wMP·min(ΔPM_e, PM_e^next)·mpWorth_e
 *   + Σ états (Pacifiste couvrant son prochain tour : 0,9·menace ; Insoignable ; Pesanteur ; invulnérabilité retirée R9)
 *   + Σ buffs (Δ dégâts futurs du porteur ; déclencheurs « dommages subis » × coups attendus) + débuffs d'ennemis
 *   + nextHitBonus ((mult − 1)·E[prochain coup d'un allié du monstre avant le tour de la cible]·0,5)
 *   + Δ poisons programmés sur les ennemis
 *   + Σ_a wHeal·min(soin_a, manquants_a)·(1 + urgence_a)   (rien au-dessus de 95 % ; 70 % pour soi, profil soigneur)
 *   − Σ_a wFF·ΔPV_a − wAllyKill·PVmax_a·[allié tué] − (wFF + reflectAversion)·PV perdus par le lanceur − ∞·[lanceur tué]
 *   + invocations (0,3·PVmax + 0,5·DPT) et résurrections
 * Le terme `positionDuringTurn·Δpos` est ajouté par le cerveau (position.ts). Les poussées et collisions (R6), le
 * renvoi (R7/R8), les sous-sorts et les déclencheurs sont dans l'état simulé.
 *
 * `quickMonster` : estimation ANALYTIQUE du même score, sans clone (profils de sorts, DPT par lancer, zones), qui ne
 * sert qu'à TRIER les candidats avant simulation (topK).
 */
import { expectedApMpRemoved } from '../../damage/apmp'
import { canCast } from '../../engine/cast'
import { heal as healFormula } from '../../damage/heal'
import type { Stats } from '../../core/types'
import { matchesTargetMask } from '../../engine/targetMask'
import { isStaticFighter } from '../../engine/targetMask'
import type { Buff, Fighter, FightState } from '../../engine/types'
import { distance } from '../../map/geometry'
import { zoneEfficiency, zoneMembership } from '../../map/zones'
import type { ZoneSpec } from '../../data/model'
import { applyMacro, simClone } from '../core/sim'
import { killProbability } from '../core/kill'
import { flagAtNextTurn, hpEff, nextTurnApMp } from '../core/threat'
import { pendingDotOn } from '../core/value'
import { believedCell } from '../core/view'
import type { MonsterContext } from './context'
import type { MonsterCandidate, ScoreParts } from './types'

export function emptyParts(): ScoreParts {
  return {
    damage: 0, kills: 0, removal: 0, states: 0, buffs: 0, nextHit: 0, dot: 0, heal: 0, friendly: 0, self: 0,
    summons: 0, position: 0, special: 0, total: 0, offensive: false, casterDead: false, blocked: false,
  }
}

export function totalOf(p: ScoreParts): number {
  return p.damage + p.kills + p.removal + p.states + p.buffs + p.nextHit + p.dot + p.heal + p.friendly + p.self
    + p.summons + p.position + p.special
}

// ───────────────────────────── valeur des caractéristiques ─────────────────────────────

const ELEMENT_STATS = new Set<keyof Stats>(['strength', 'intelligence', 'chance', 'agility'])
const DAMAGE_STATS = new Set<keyof Stats>(['damage', 'neutralDamage', 'earthDamage', 'fireDamage', 'waterDamage', 'airDamage'])
const PCT_DAMAGE_STATS = new Set<keyof Stats>(['spellDamagePct', 'finalDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'weaponDamagePct'])
const PCT_RES_STATS = new Set<keyof Stats>(['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct', 'allResPct', 'meleeResPct', 'rangedResPct', 'spellResPct'])
const FIXED_RES_STATS = new Set<keyof Stats>(['neutralRes', 'earthRes', 'fireRes', 'waterRes', 'airRes', 'criticalRes'])

/** Décote des tours suivants d'un buff de `turns` tours (−1 = permanent ⇒ 3 tours). */
function turnsFactor(turns: number): number {
  const n = turns < 0 ? 3 : Math.max(1, Math.min(3, turns))
  let v = 0
  let k = 1
  for (let i = 0; i < n; i++, k *= 0.7) v += k
  return v
}

/** Caractéristique élémentaire la plus haute (approximation de la stat « utile » d'un porteur multi-éléments). */
function mainElementStat(f: Fighter): number {
  const st = f.stats
  return Math.max(st.strength, st.intelligence, st.chance, st.agility, 0)
}

/** Dégâts entrants attendus sur `holder` (somme des deux plus grosses menaces qui l'atteignent). */
function incomingOn(ctx: MonsterContext, holder: Fighter): number {
  let a = 0
  let b = 0
  for (const e of ctx.enemies()) {
    const r = ctx.attackReach(e)
    if (r < 0 || distance(believedCell(e, ctx.team), holder.cell) > r) continue
    const t = ctx.threatOf(e)
    if (t > a) {
      b = a
      a = t
    } else if (t > b) b = t
  }
  return a + 0.5 * b
}

/** Valeur (PVe, un tour) d'un gain de caractéristique `amount` pour `holder` (allié du monstre, soi compris). */
export function statGainValue(ctx: MonsterContext, holder: Fighter, stat: keyof Stats, amount: number): number {
  if (!amount) return 0
  const st = holder.stats as unknown as Record<string, number>
  if (stat === 'ap') return (ctx.bestDpt(holder) / Math.max(1, holder.stats.ap)) * amount * 0.8
  if (stat === 'mp') return 12 * Math.min(amount, 3)
  if (stat === 'power' || stat === 'spellPower') return (ctx.bestDpt(holder) * amount) / (200 + mainElementStat(holder) + Math.max(0, holder.stats.power))
  if (ELEMENT_STATS.has(stat)) return (0.5 * ctx.bestDpt(holder) * amount) / (200 + Math.max(0, st[stat] ?? 0) + Math.max(0, holder.stats.power))
  if (DAMAGE_STATS.has(stat)) return 3 * amount
  if (stat === 'criticalDamage') return 0.3 * amount
  if (PCT_DAMAGE_STATS.has(stat)) return (ctx.bestDpt(holder) * amount) / 100
  if (PCT_RES_STATS.has(stat)) return (0.5 * incomingOn(ctx, holder) * amount) / 100
  if (FIXED_RES_STATS.has(stat)) return 0.5 * amount
  if (stat === 'pushDamage') return 0.3 * amount
  if (stat === 'vitality') return amount
  return 0
}

/** Valeur (PVe) d'une baisse de caractéristique `amount` (> 0) infligée à l'ennemi `e`. */
function debuffValue(ctx: MonsterContext, e: Fighter, stat: keyof Stats, amount: number): number {
  const st = e.stats as unknown as Record<string, number>
  const th = ctx.threatOf(e)
  if (stat === 'ap' || stat === 'mp') return 0 // retraits : terme `removal`
  if (stat === 'power' || stat === 'spellPower' || ELEMENT_STATS.has(stat)) {
    const base = stat === 'power' || stat === 'spellPower' ? mainElementStat(e) : Math.max(0, st[stat] ?? 0)
    return (0.5 * th * amount) / (200 + base + Math.max(0, e.stats.power))
  }
  if (DAMAGE_STATS.has(stat)) return 1.5 * amount
  if (PCT_DAMAGE_STATS.has(stat)) return (th * amount) / 100
  if (PCT_RES_STATS.has(stat)) return (0.5 * teamDptOn(ctx, e) * amount) / 100
  if (FIXED_RES_STATS.has(stat)) return 0.3 * amount
  if (stat === 'pushRes') return 0.1 * amount
  if (stat === 'tackleBlock' || stat === 'tackleEvade' || stat === 'apParry' || stat === 'mpParry') return 0.2 * amount
  if (stat === 'range') return 0.05 * th * amount
  return 0
}

/** Dégâts attendus de l'équipe du monstre sur `e` avant son prochain tour (lanceur compris). */
function teamDptOn(ctx: MonsterContext, e: Fighter): number {
  const order = ctx.order()
  let v = ctx.dpt.dpt(ctx.me, e) * 0.5
  for (const a of ctx.allies()) {
    if (isStaticFighter(a) || !order.before(a.id, e.id)) continue
    v += ctx.dpt.dpt(a, e)
  }
  return v
}

// ───────────────────────────── buffs ─────────────────────────────

/** Effets de buffs déclenchés qui augmentent une caractéristique du porteur (Bouclier absorbant : 138, 128). */
const STAT_TRIGGER: Record<number, keyof Stats> = {
  110: 'vitality', 111: 'ap', 112: 'damage', 115: 'critical', 117: 'range', 118: 'strength', 119: 'agility', 123: 'chance',
  125: 'vitality', 126: 'intelligence', 128: 'mp', 138: 'power', 178: 'heals', 414: 'pushDamage',
}

/**
 * Nombre attendu de déclenchements « dommages subis » (D, DR, DM…) d'un buff sur `holder` pendant sa durée : 1 par
 * ennemi qui l'atteint au prochain tour, 0,5 s'il ne l'atteint qu'au tour suivant (buff de ≥ 2 tours), en respectant la
 * distance du déclencheur (DR : à distance, DM : au contact).
 */
function expectedHits(ctx: MonsterContext, holder: Fighter, triggers: string, turns: number): number {
  const ranged = /(^|\|)DR(\||$)/.test(triggers)
  const melee = /(^|\|)DM(\||$)/.test(triggers)
  let n = 0
  for (const e of ctx.enemies()) {
    if (ctx.threatOf(e) <= 0) continue
    const r = ctx.attackReach(e)
    if (r < 0) continue
    const mp = Math.floor(nextTurnApMp(e, ctx.order()).mp)
    const maxRange = r - mp
    if (ranged && maxRange <= 1) continue
    if (melee && maxRange > 1 && !ctx.spellProfiles(e).some(p => p.damage.length && p.maxRange <= 1)) continue
    const d = distance(believedCell(e, ctx.team), holder.cell)
    if (d <= r) n += 1
    else if (turns >= 2 && d <= r + mp) n += 0.5
  }
  return n
}

const MAX_STACK = new Map<number, number>()

/** Cumul maximal des effets d'un sort (`maxStack` du niveau ; ≤ 0 = illimité). */
function maxStackOf(ctx: MonsterContext, spellId: number): number {
  let v = MAX_STACK.get(spellId)
  if (v === undefined) {
    const ks = ctx.me.spells.find(s => s.spellId === spellId)
    v = (ks ? ks.level.maxStack : ctx.engine.data.spellLevel(spellId, { grade: undefined })?.maxStack) ?? 0
    MAX_STACK.set(spellId, v)
  }
  return v
}

/** Signature d'un buff (même sort, même effet, même valeur) : un cumul au plafond remplace le plus ancien (R21). */
function buffSig(b: Buff): string {
  return `${b.spellId}:${b.effect.effectId}:${b.value}:${b.triggers ?? ''}`
}

/**
 * Valeur des nouveaux buffs de `f1` (allié du monstre, soi compris) : caractéristiques et déclencheurs. Un nouveau
 * buff qui remplace un buff identique retiré par le même lancer (cumul au plafond, `maxStack`) ne vaut rien (R21).
 */
function allyBuffsValue(ctx: MonsterContext, f0: Fighter, f1: Fighter, known: Set<number> | undefined): number {
  if (f0.buffs.length === f1.buffs.length && f0.buffs.every((b, i) => f1.buffs[i].uid === b.uid)) return 0
  let v = 0
  const triggerCount = new Map<string, number>()
  let replaced: Map<string, number> | undefined
  if (known && known.size && f0.buffs.length) {
    const now = new Set<number>()
    for (const b of f1.buffs) now.add(b.uid)
    for (const b of f0.buffs) {
      if (now.has(b.uid)) continue
      replaced ??= new Map()
      const k = buffSig(b)
      replaced.set(k, (replaced.get(k) ?? 0) + 1)
    }
  }
  for (const b of f1.buffs) {
    if (known?.has(b.uid)) continue
    if (replaced) {
      const k = buffSig(b)
      const n = replaced.get(k) ?? 0
      if (n > 0) {
        replaced.set(k, n - 1)
        continue
      }
    }
    // Cumul déjà au plafond du sort à la racine : le moteur peut l'empiler quand même (déclencheurs), l'IA non (R21).
    const cap = maxStackOf(ctx, b.spellId)
    if (cap > 0) {
      let n = 0
      for (const x of f0.buffs) if (x.spellId === b.spellId && x.effect.effectId === b.effect.effectId) n++
      if (n >= cap) continue
    }
    if (b.kind === 'trigger' && b.triggers && /(^|\|)D[RMAEFNW]?(\||$)/.test(b.triggers)) {
      const stat = STAT_TRIGGER[b.effect.effectId]
      if (!stat) continue
      let hits = triggerCount.get(b.triggers)
      if (hits === undefined) triggerCount.set(b.triggers, (hits = Math.min(3, expectedHits(ctx, f1, b.triggers, b.remaining))))
      const amount = b.value || b.effect.diceNum
      v += hits * statGainValue(ctx, f1, stat, amount) * turnsFactor(Math.max(1, b.remaining - 1))
      continue
    }
    const sd = b.statDelta
    if (!sd || b.delay > 0) continue
    for (const k in sd) {
      const amount = sd[k as keyof Stats] ?? 0
      if (amount > 0) v += statGainValue(ctx, f1, k as keyof Stats, amount) * turnsFactor(b.remaining)
      else if (amount < 0) v -= 0.5 * statGainValue(ctx, f1, k as keyof Stats, -amount) * turnsFactor(b.remaining)
    }
  }
  return v
}

/** Le buff `b` (d'un ennemi) est-il bénéfique à son porteur ? (désenvoûtement) */
function beneficial(ctx: MonsterContext, b: Buff): boolean {
  if (b.stateId !== undefined) {
    const st = ctx.engine.data.state(b.stateId)
    if (st && (st.invulnerable || st.invulnerableMelee || st.invulnerableRange || st.cantBeTackled)) return true
  }
  if (b.statDelta) for (const k in b.statDelta) if ((b.statDelta[k as keyof Stats] ?? 0) > 0) return true
  return b.spellMod !== undefined
}

// ───────────────────────────── score simulé ─────────────────────────────

/** Le sort du candidat inflige-t-il des dégâts aux ennemis (condition « tentative offensive » de R13) ? */
function offensiveSpell(ctx: MonsterContext, c: MonsterCandidate): boolean {
  if (c.spellIndex < 0) return false
  const p = ctx.spellProfiles()[c.spellIndex]
  return !!p && p.damage.some(d => d.sides.enemy)
}

/** Score simulé d'un candidat (voir l'en-tête) : `after` = clone de la racine du pas après la macro-action. */
export function scoreTransition(ctx: MonsterContext, after: FightState, c: MonsterCandidate): ScoreParts {
  const parts = emptyParts()
  const root = ctx.fight
  const w = ctx.w
  const snap = ctx.snapshot()
  const order = ctx.order()
  const meId = ctx.me.id
  const me0 = root.fighters[meId]
  const me1 = after.fighters[meId]
  // R7 : un lancer qui tue le lanceur (renvoi, déclencheur) vaut −∞, sauf le sort suicidaire d'un kamikaze (141 sur
  // lui-même), joué seulement si ses effets valent plus que 1,5 × ses PV (monster-ai.md §3).
  const selfKill = !me1 || !me1.alive
  if (selfKill && !kamikazeCast(ctx, c)) {
    parts.casterDead = true
    parts.total = -Infinity
    return parts
  }
  if (selfKill) parts.self -= 1.5 * ctx.root(meId).hpEff[meId]
  const tmp = { ap: 0, mp: 0 }
  let enemyEffect = 0
  for (const f0 of root.fighters) {
    if (!f0.alive) continue
    const f1 = after.fighters[f0.id]
    // Combattant intact (cas le plus fréquent : le lancer ne l'a pas touché) : aucune contribution.
    if (f0.id !== meId && f1 && unchanged(f0, f1)) continue
    ctx.root(f0.id)
    const dead = !f1 || !f1.alive
    const hb = snap.hpEff[f0.id]
    const ha = dead ? 0 : hpEff(f1)
    if (f0.id === meId) {
      if (selfKill) continue
      const loss = hb - ha
      if (loss > 0) parts.self -= (w.wFF + w.reflectAversion) * Math.min(loss, hb)
      const gain = f1.hp - f0.hp
      const threshold = ctx.archetype.capabilities.heal ? w.selfHealThreshold : w.healThreshold
      if (gain > 0 && f0.hp < threshold * f0.maxHp) {
        const missing = f0.maxHp - f0.hp
        parts.heal += w.wHeal * Math.min(gain, missing) * (1 + missing / Math.max(1, f0.maxHp))
      }
      parts.buffs += allyBuffsValue(ctx, f0, f1, snap.buffUids[f0.id])
      parts.special += selfMobility(ctx, me0, me1, c)
      continue
    }
    if (ctx.isEnemy(f0)) {
      const v = ctx.damageValue(f0)
      const dmg = hb - ha
      if (dmg > 0) parts.damage += w.wDmg * v * Math.min(dmg, hb)
      else if (dmg < 0) parts.damage += w.wDmg * Math.max(v, 0.5) * dmg
      if (dead) {
        const k = w.wKill * (w.kappa * f0.maxHp + ctx.threatOf(f0))
        parts.kills += k
        enemyEffect += k
        continue
      }
      if (dmg > 0) enemyEffect += dmg
      // Retraits de PA/PM qui couvrent le prochain tour de l'ennemi.
      nextTurnApMp(f1, order, tmp)
      const ap0 = snap.apNext[f0.id]
      const mp0 = snap.mpNext[f0.id]
      const dAp = ap0 - tmp.ap
      const dMp = mp0 - tmp.mp
      if (dAp > 1e-9) {
        const x = w.wAP * Math.min(dAp, ap0) * (ctx.threatOf(f0) / Math.max(1, ap0))
        parts.removal += x
        enemyEffect += x + 1
      }
      if (dMp > 1e-9) {
        const x = w.wMP * Math.min(dMp, mp0) * ((ctx.alphaMp(f0) * ctx.threatOf(f0)) / Math.max(1, mp0))
        parts.removal += x
        enemyEffect += x + 1
      }
      const sv = enemyStates(ctx, f0, f1)
      parts.states += sv
      if (sv > 0) enemyEffect += sv
      const bv = enemyBuffs(ctx, f0, f1, me1, c)
      parts.nextHit += bv.nextHit
      parts.buffs += bv.debuff
      parts.states += bv.dispel
      if (bv.nextHit + bv.debuff + bv.dispel > 0) enemyEffect += bv.nextHit + bv.debuff + bv.dispel
      // Poisons NOUVEAUX seulement, évalués sur la cible de la racine : un « dommages subis ×150 % » posé par le même
      // lancer (Plumière, Tirs optiques) ne doit pas revaloriser les poisons déjà programmés (terme `nextHit`).
      const d = newDotValue(after, f0, f1, snap.buffUids[f0.id])
      if (d > 0) {
        const x = w.wDmg * v * Math.min(d, ha)
        parts.dot += x
        enemyEffect += x
      }
      continue
    }
    if (f0.team !== ctx.team) continue
    // Allié du monstre.
    if (dead) {
      parts.friendly -= w.wAllyKill * f0.maxHp
      continue
    }
    const loss = hb - ha
    if (loss > 0) parts.friendly -= w.wFF * Math.min(loss, hb)
    const gain = f1.hp - f0.hp
    if (gain > 0 && f0.hp < w.healThreshold * f0.maxHp) {
      const missing = f0.maxHp - f0.hp
      parts.heal += w.wHeal * Math.min(gain, missing) * (1 + missing / Math.max(1, f0.maxHp))
    }
    const dShield = f1.shield - f0.shield
    if (dShield > 0) parts.heal += 0.5 * Math.min(dShield, Math.max(incomingOn(ctx, f0), 0.1 * f0.maxHp))
    parts.buffs += allyBuffsValue(ctx, f0, f1, snap.buffUids[f0.id])
    nextTurnApMp(f1, order, tmp)
    const dAp = snap.apNext[f0.id] - tmp.ap
    const dMp = snap.mpNext[f0.id] - tmp.mp
    if (dAp > 1e-9 || dMp > 1e-9) parts.friendly -= 20 * Math.max(0, dAp) + 10 * Math.max(0, dMp)
    if (!ctx.engine.stateFlag(f0, 'invulnerable') && ctx.engine.stateFlag(f1, 'invulnerable')) parts.states += Math.min(incomingOn(ctx, f0), f0.hp)
  }
  // Invocations et résurrections du camp du monstre.
  for (const f1 of after.fighters) {
    if (!f1.alive || f1.team !== ctx.team || f1.id === meId) continue
    const f0 = root.fighters[f1.id]
    if (f0 && f0.alive) continue
    const dpt = ctx.bestDpt(f1, after)
    parts.summons += f0 ? 0.5 * f1.hp + 0.5 * dpt : 0.3 * f1.maxHp + 0.5 * dpt
  }
  parts.offensive = enemyEffect > 0
  parts.blocked = !parts.offensive && offensiveSpell(ctx, c)
  parts.total = totalOf(parts)
  return parts
}

/** Dégâts programmés (poisons TB/TE, décote 0,8 par tour) des buffs de `f1` absents de la racine, sur la cible `f0`. */
function newDotValue(after: FightState, f0: Fighter, f1: Fighter, known: Set<number> | undefined): number {
  let news: Buff[] | undefined
  for (const b of f1.buffs) {
    if (b.kind !== 'trigger' || known?.has(b.uid) || !b.triggers || !/(^|\|)(TB|TE)(\||$)/.test(b.triggers)) continue
    ;(news ??= []).push(b)
  }
  return news ? pendingDotOn(after, { ...f0, buffs: news }, 0.8) : 0
}

/** Le candidat est-il le sort suicidaire d'un kamikaze (effet 141 « tue » visant le lanceur) ? */
function kamikazeCast(ctx: MonsterContext, c: MonsterCandidate): boolean {
  if (c.spellIndex < 0 || !(ctx.profile.capabilities?.kamikaze ?? ctx.archetype.capabilities.kamikaze)) return false
  return ctx.me.spells[c.spellIndex].level.effects.some(e => e.effectId === 141 && /(^|,)[cC](,|$)/.test(e.targetMask))
}

/** `f1` est-il identique à `f0` pour le score (vie, bouclier, PV max, buffs, états) ? */
function unchanged(f0: Fighter, f1: Fighter): boolean {
  if (f0.alive !== f1.alive || f0.hp !== f1.hp || f0.shield !== f1.shield || f0.maxHp !== f1.maxHp) return false
  const a = f0.buffs
  const b = f1.buffs
  if (a.length !== b.length || f0.states.length !== f1.states.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].uid !== b[i].uid || a[i].remaining !== b[i].remaining) return false
  return true
}

/** Valeur de mobilité des PM volés pendant ce lancer (`mpStealIsMobility`, Hoxor du Buboxor). */
function selfMobility(ctx: MonsterContext, me0: Fighter, me1: Fighter, c: MonsterCandidate): number {
  if (!ctx.profile.mpStealIsMobility) return 0
  const pathMp = c.path ? c.path.length - 1 : 0
  const gained = me1.mp - Math.max(0, me0.mp - pathMp)
  if (gained <= 0) return 0
  // Le contact d'un ennemi devient-il accessible grâce aux PM volés ?
  let best = 0
  for (const e of ctx.enemies()) {
    const d = distance(me1.cell, believedCell(e, ctx.team)) - 1
    if (d <= 0) continue
    if (d <= me1.mp && d > me1.mp - gained) best = Math.max(best, 0.5 * ctx.bestSingle(me1, e))
  }
  return best > 0 ? best : 8 * Math.min(gained, 3)
}

/** États gagnés / perdus par un ennemi (Pacifiste, Insoignable, Pesanteur, invulnérabilité retirée — R9). */
function enemyStates(ctx: MonsterContext, f0: Fighter, f1: Fighter): number {
  if (f0.states.length === f1.states.length && f0.states.every((x, i) => f1.states[i] === x)) return 0
  const th = ctx.threatOf(f0)
  const engine = ctx.engine
  const custom = ctx.profile.stateValue
  let v = 0
  let pacified = false
  for (const id of f1.states) {
    if (f0.states.includes(id)) continue
    const c = custom?.[id]
    if (c !== undefined) {
      if (c === 'targetThreat') {
        if (!pacified && flagAtNextTurn(engine, f1, 'cantDealDamage', ctx.order())) v += ctx.w.pacifist * th
        else if (!pacified) v += 0.3 * ctx.w.pacifist * th
        pacified = true
      } else v += c
      continue
    }
    const st = engine.data.state(id)
    if (!st) continue
    if (st.cantDealDamage && !pacified) {
      pacified = true
      if (flagAtNextTurn(engine, f1, 'cantDealDamage', ctx.order())) v += ctx.w.pacifist * th
    } else if (st.incurable) v += (ctx.enemyHasHealer() ? 0.1 : 0.02) * f0.maxHp
    else if (id === 7 || id === 6 || st.cantBeMoved || st.cantSwitchPosition) v += 0.3 * ctx.alphaMp(f0) * th
  }
  for (const id of f0.states) {
    if (f1.states.includes(id)) continue
    const st = engine.data.state(id)
    if (st && st.invulnerable) v += 0.5 * th + 0.1 * f0.maxHp
  }
  return v
}

/** Nouveaux buffs / buffs retirés d'un ennemi : bonus « prochain coup » (1163, 786), débuffs, désenvoûtement. */
function enemyBuffs(ctx: MonsterContext, f0: Fighter, f1: Fighter, me1: Fighter, c: MonsterCandidate): { nextHit: number; debuff: number; dispel: number } {
  const out = { nextHit: 0, debuff: 0, dispel: 0 }
  const known = ctx.root(f0.id).buffUids[f0.id]
  let hitE = -1
  const hit = () => (hitE >= 0 ? hitE : (hitE = ctx.nextAllyHit(f0, ctx.fight, me1.alive ? me1.ap : 0, c.cast?.spellId ?? -1)))
  let added = 0
  for (const b of f1.buffs) {
    if (known?.has(b.uid)) continue
    added++
    const id = b.effect.effectId
    if (id === 1163) {
      const pct = b.effect.diceNum || b.value
      if (pct > 100) out.nextHit += ((pct - 100) / 100) * hit() * 0.5
      continue
    }
    if (id === 786) {
      let wounded = false
      for (const a of ctx.allies()) if (a.hp < 0.9 * a.maxHp) wounded = true
      out.nextHit += 0.25 * hit() * (wounded || me1.hp < 0.9 * me1.maxHp ? 1 : 0.3)
      continue
    }
    const sd = b.statDelta
    if (!sd || b.delay > 0) continue
    for (const k in sd) {
      const amount = sd[k as keyof Stats] ?? 0
      if (amount < 0) out.debuff += debuffValue(ctx, f1, k as keyof Stats, -amount) * turnsFactor(b.remaining)
    }
  }
  // Buffs retirés (désenvoûtement) : seulement si des buffs de la racine manquent.
  if (known && known.size && f1.buffs.length - added < f0.buffs.length) {
    let n = 0
    const now = new Set(f1.buffs.map(b => b.uid))
    for (const b of f0.buffs) if (!now.has(b.uid) && b.dispellable && beneficial(ctx, b)) n++
    if (n) out.dispel += Math.min(0.3, 0.05 * n) * ctx.threatOf(f0)
  }
  return out
}

// ───────────────────────────── suite d'un lancer (overrides, anticipation) ─────────────────────────────

/**
 * Score simulé du meilleur lancer de `spellId` depuis la case actuelle du monstre dans l'état `sim` (déjà un clone) :
 * cases visées = combattants vivants et case du lanceur. Sert aux overrides (Attraction ailée → Cercle de feu) et à
 * l'anticipation des profils (`lookahead`). 0 si rien n'est lançable.
 */
export function followUpScore(ctx: MonsterContext, sim: FightState, spellId: number): number {
  const me = sim.fighters[ctx.me.id]
  if (!me || !me.alive) return 0
  const si = me.spells.findIndex(s => s.spellId === spellId)
  if (si < 0) return 0
  const cells = new Set<number>([me.cell])
  for (const f of sim.fighters) if (f.alive && f.cell >= 0 && f.carriedBy === undefined) cells.add(f.cell)
  return ctx.withRoot(sim, () => {
    let best = 0
    const ks = me.spells[si]
    for (const cell of cells) {
      if (canCast(ctx.engine, sim, me, ks, cell) !== null) continue
      const clone = simClone(ctx.view, sim, 0x51f7 ^ cell)
      const cand: MonsterCandidate = { cast: { spellId, cell }, cat: 'damage', prior: 0, key: `${spellId}:${cell}:${me.cell}`, spellIndex: si, from: me.cell }
      if (!applyMacro(ctx.engine, clone, me.id, cand)) continue
      const v = scoreTransition(ctx, clone, cand).total
      if (v > best) best = v
    }
    return best
  })
}

// ───────────────────────────── préfiltre analytique ─────────────────────────────

const ZONE_MEMO = new Map<ZoneSpec, Map<number, (cell: number) => boolean>>()

function inZoneFn(zone: ZoneSpec, center: number, from: number): (cell: number) => boolean {
  let byKey = ZONE_MEMO.get(zone)
  if (!byKey) ZONE_MEMO.set(zone, (byKey = new Map()))
  const k = center * 1024 + from
  let fn = byKey.get(k)
  if (!fn) {
    if (byKey.size > 4096) byKey.clear()
    byKey.set(k, (fn = zoneMembership(zone, center, from)))
  }
  return fn
}

/**
 * Estimation analytique (PVe) d'un candidat, sans clone : mêmes termes que `scoreTransition` (dégâts plafonnés et
 * probabilité de kill, retraits espérés, Pacifiste, « prochain coup », soins, boucliers, buffs, invocations, tir ami)
 * + `positionDuringTurn·Δpos` fourni par l'appelant. Sert seulement à TRIER.
 */
export function quickMonster(ctx: MonsterContext, c: MonsterCandidate, dPos = 0): number {
  if (c.spellIndex < 0 || !c.cast) return dPos
  const me = ctx.me
  const s = ctx.fight
  const w = ctx.w
  const p = ctx.spellProfiles()[c.spellIndex]
  if (!p) return dPos
  const from = c.from
  const target = c.cast.cell
  const calib = ctx.dpt.calibration(me)
  const zone = p.aim === 'ring' && p.ringZone ? p.ringZone : p.zone
  const inZone = zone && p.zoneRadius > 0 ? inZoneFn(zone, target, from) : null
  const lineHit = (z: ZoneSpec, mask: string, f: Fighter, cell: number): number => {
    if (!inZoneFn(z, target, from)(cell) || !matchesTargetMask(mask, me, f)) return 0
    return zoneEfficiency(z, target, cell, from)
  }
  let value = dPos
  let touched = 0
  for (const f of s.fighters) {
    if (!f.alive || f.carriedBy !== undefined) continue
    const cell = f.id === me.id ? from : believedCell(f, ctx.team)
    if (cell < 0) continue
    const enemy = ctx.isEnemy(f)
    const he = hpEff(f)
    if (p.damage.length && (inZone ? inZone(cell) : cell === target)) {
      const eff = inZone ? zoneEfficiency(zone!, target, cell, from) : 1
      const cd = ctx.dpt.perCast(me, c.spellIndex, f)
      const atCenter = cell === target
      const mean = ((atCenter ? cd.centerMean : cd.ringMean) ?? cd.mean) * eff * calib
      const variance = ((atCenter ? cd.centerVar : cd.ringVar) ?? cd.variance) * eff * eff * calib * calib
      if (mean > 0) {
        if (enemy) {
          touched++
          value += w.wDmg * ctx.damageValue(f) * Math.min(mean, he)
          const pk = killProbability(mean, variance, f.hp + f.shield)
          if (pk > 1e-4) value += pk * w.wKill * (w.kappa * f.maxHp + ctx.threatOf(f))
        } else if (f.id === me.id) {
          value -= (w.wFF + w.reflectAversion) * Math.min(mean, he)
        } else if (f.team === ctx.team) {
          value -= w.wFF * Math.min(mean, he) + (mean >= he ? w.wAllyKill * f.maxHp : 0)
        }
      }
    }
    if (enemy) {
      let dAp = 0
      let dMp = 0
      for (const r of p.removals) {
        if (r.delay > 0 || r.duration < 1 || !lineHit(r.zone, r.mask, f, cell)) continue
        const pool = r.pool
        const pts = Math.max(0, f.stats[pool] - (pool === 'ap' ? dAp : dMp))
        const removed = r.dodgeable
          ? expectedApMpRemoved(pool === 'ap' ? me.stats.apReduction : me.stats.mpReduction, pool === 'ap' ? f.stats.apParry : f.stats.mpParry, pts, pts, Math.round(r.value))
          : Math.min(pts, r.value)
        if (pool === 'ap') dAp += removed
        else dMp += removed
      }
      if (dAp > 0) value += w.wAP * dAp * (ctx.threatOf(f) / Math.max(1, f.stats.ap))
      if (dMp > 0) value += w.wMP * dMp * ((ctx.alphaMp(f) * ctx.threatOf(f)) / Math.max(1, f.stats.mp))
      if (dAp > 0 || dMp > 0) touched++
      let pacified = false
      for (const st of p.states) {
        if (st.remove || !lineHit(st.zone, st.mask, f, cell)) continue
        touched++
        const custom = ctx.profile.stateValue?.[st.stateId]
        const data = ctx.engine.data.state(st.stateId)
        if (custom === 'targetThreat' || (custom === undefined && data?.cantDealDamage)) {
          if (!pacified && st.duration >= 1) value += w.pacifist * ctx.threatOf(f)
          pacified = true
        } else if (typeof custom === 'number') value += custom
        else if (data?.incurable) value += (ctx.enemyHasHealer() ? 0.1 : 0.02) * f.maxHp
      }
      for (const rl of p.received) {
        if (rl.pct > 100 && lineHit(rl.zone, rl.mask, f, cell)) value += ((rl.pct - 100) / 100) * 0.5 * ctx.bestSingle(me, f)
      }
      for (const mv of p.moves) if (!mv.onCaster && lineHit(mv.zone, mv.mask, f, cell)) value += 10
      for (const sl of p.stats) if (sl.sign < 0 && lineHit(sl.zone, sl.mask, f, cell)) value += debuffValue(ctx, f, sl.stat, sl.value) * turnsFactor(sl.duration)
      if (p.removesStates && cell === target && ctx.engine.stateFlag(f, 'invulnerable')) value += 0.5 * ctx.threatOf(f) + 0.1 * f.maxHp
      continue
    }
    if (f.team !== ctx.team && f.id !== me.id) continue
    // Alliés (soi compris).
    const missing = f.maxHp - f.hp
    const threshold = f.id === me.id && ctx.archetype.capabilities.heal ? w.selfHealThreshold : w.healThreshold
    if (missing > 0 && f.hp < threshold * f.maxHp) {
      for (const h of p.heals) {
        const eff = lineHit(h.zone, h.mask, f, cell)
        if (!eff) continue
        const base = (h.min + h.max) / 2
        const amount = h.kind === 'pctMax' ? (base * f.maxHp) / 100 : h.kind === 'fixed' ? base : healFormula(base, me.stats, { element: h.element >= 0 ? (h.element as 0) : undefined })
        value += w.wHeal * Math.min(amount * h.p * eff, missing) * (1 + missing / Math.max(1, f.maxHp))
      }
    }
    for (const sh of p.shields) {
      const eff = lineHit(sh.zone, sh.mask, f, cell)
      if (!eff) continue
      const amount = sh.kind === 'pctLevel' ? (sh.value * me.level) / 100 : sh.kind === 'pctMaxHp' ? (sh.value * me.maxHp) / 100 : sh.value
      value += 0.5 * Math.min(amount * eff, Math.max(incomingOn(ctx, f), 0.1 * f.maxHp))
    }
    for (const sl of p.stats) {
      if (sl.sign < 0 || !lineHit(sl.zone, sl.mask, f, cell)) continue
      value += statGainValue(ctx, f, sl.stat, sl.value) * turnsFactor(sl.duration)
    }
  }
  // Vols de caractéristiques au profit du lanceur (Hoxor : PM ; Attraction ailée : Agilité).
  if (ctx.profile.mpStealIsMobility && p.removals.some(r => r.steal && r.pool === 'mp')) value += 16
  // Invocations : priorité de Stump (invocation > buff > dégâts).
  for (const sl of p.summonLines) {
    if (sl.revive) {
      if (s.fighters.some(f => !f.alive && f.team === ctx.team && f.id !== me.id)) value += 0.4 * me.baseMaxHp
      continue
    }
    if (ctx.fighterAt(target) === undefined) value += 300
  }
  if (p.glyph || p.trap) value += 50
  // Effets que l'analytique ne voit pas (sous-sorts, déclencheurs) : valeur d'exploration minimale si un ennemi est
  // concerné, pour que la simulation tranche.
  if (touched > 0 && value < 5 && p.analyticCoverage < 1) value = 5
  return value
}
