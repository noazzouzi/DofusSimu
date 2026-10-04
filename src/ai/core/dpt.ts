/**
 * Dégâts par tour analytiques (docs/design/ai.md §6.4) — WP1.
 *
 * `perCast(a, sort, d)` : espérance (et variance) des dégâts d'UN lancer de `a` sur `d` au centre de la zone : lignes
 * de dégâts du profil acceptées par le masque (pipeline DoMath : caractéristiques et buffs de `a`, résistances, armure
 * et « dommages subis » de `d`, critique pondéré) + DoT × min(durée, 2) × 0,8 + effets différés × 0,8.
 * `dpt(a, d, ap)` : sac à dos borné sur les PA (≤ 24 ; `castsPerTurn`, `castsPerTarget`, relances) du meilleur tour
 * de `a` contre `d` sans contrainte de position, × calibration (`data/ai/calibration.json`, bornée à [0,5 ; 2]).
 * Caches par empreintes « dégâts » (`damageDigest`, mémoïsées par `Fighter.rev` E4), PA, relances ; les PV n'entrent
 * dans la clé que pour les sorts en % de PV (lancers « % PV » jamais cachés).
 */
import calibrationJson from '../../../data/ai/calibration.json'
import { Element, type Stats } from '../../core/types'
import { createPreparedDamage, rollPrepared, prepareDamage, type DamageInput } from '../../damage/damage'
import { hpBasedDamage, hpReference, type HpBasedDamageInput, type HpSnapshot } from '../../damage/life'
import { armorReduction } from '../../damage/misc'
import { critChance } from '../../damage/crit'
import { spellBaseDamageBonus, spellDamageBonus } from '../../engine/effects/buffs/spellMods'
import type { TriggerEvent } from '../../engine/effects/core'
import { buffApplies, DAMAGE_SPECS, resolveElement, unerodedMaxHp } from '../../engine/effects/damage/pipeline'
import type { Engine } from '../../engine/engine'
import { matchesTargetMask } from '../../engine/targetMask'
import type { Fighter, KnownSpell } from '../../engine/types'
import type { ZoneSpec } from '../../data/model'
import { compileZone } from '../../map/zones'
import type { DptTable } from '../types'
import { damageDigest, fnvInt } from './hash'
import { createSpellProfileIndex, type DamageLineX, type SpellProfileIndexX, type SpellProfileX } from './spellProfile'

// ───────────────────────────── calibration ─────────────────────────────

export interface CalibrationTable {
  default: number
  presets: Record<string, number>
  breeds: Record<string, number>
  monsters: Record<string, number>
}
const CALIB = calibrationJson as unknown as CalibrationTable
const CALIB_MIN = 0.5
const CALIB_MAX = 2

/** Facteur de calibration d'un combattant : preset (`tags.presetId`), sinon classe, sinon monstre ; borné. */
export function calibrationOf(f: Fighter, table: CalibrationTable = CALIB): number {
  const preset = f.tags.presetId
  let v: number | undefined
  if (typeof preset === 'string') v = table.presets[preset]
  if (v === undefined && f.breedId !== undefined) v = table.breeds[String(f.breedId)]
  if (v === undefined && f.monsterId !== undefined) v = table.monsters[String(f.monsterId)]
  v ??= table.default ?? 1
  return v < CALIB_MIN ? CALIB_MIN : v > CALIB_MAX ? CALIB_MAX : v
}

// ───────────────────────────── modificateurs de la cible ─────────────────────────────

const EV: TriggerEvent = { type: 'D' }

/** « Dommages subis » (1163, en %) et armure (265/105, réduite au niveau) de `d` pour un dommage de `a`. */
export function receivedMods(d: Fighter, a: Fighter, element: number, melee: boolean, isWeapon: boolean, out = { sustained: 100, armor: 0 }): { sustained: number; armor: number } {
  out.sustained = 100
  out.armor = 0
  if (!d.buffs.length) return out
  EV.type = 'D'
  EV.source = a
  EV.element = element
  EV.melee = melee
  EV.damageKind = 'direct'
  EV.isWeapon = isWeapon
  EV.killed = false
  for (const b of d.buffs) {
    const id = b.effect.effectId
    if (id === 1163) {
      if (buffApplies(b, EV, d)) {
        const v = b.kind === 'trigger' || !b.value ? (b.effect.diceNum === 0 && b.effect.diceSide === 0 ? b.effect.value : b.effect.diceNum) : b.value
        out.sustained = Math.trunc((out.sustained * v) / 100)
      }
    } else if (id === 265 || id === 105) {
      if (buffApplies(b, EV, d)) out.armor += armorReduction(b.kind === 'trigger' || !b.value ? b.effect.diceNum + b.effect.value : b.value, d.level)
    }
  }
  return out
}

// ───────────────────────────── une ligne de dégâts ─────────────────────────────

const INPUT: DamageInput = {
  attacker: undefined as unknown as Stats,
  defender: undefined as unknown as Stats,
  element: Element.Neutral,
  crit: false,
  isWeapon: false,
  isMelee: false,
  defenderIsPlayer: false,
}
const PN = createPreparedDamage()
const PC = createPreparedDamage()
const MODS = { sustained: 100, armor: 0 }
const HP_SNAP: HpSnapshot = { casterHp: 0, casterMaxHp: 0, casterBaseMaxHp: 0, targetHp: 0, targetMaxHp: 0, targetBaseMaxHp: 0 }
const HP_IN: HpBasedDamageInput = { percent: 0, referenceHp: 0, defender: undefined as unknown as Stats, element: -1, defenderIsPlayer: false }

/** Résultat partagé d'un calcul de ligne (à lire immédiatement). */
export const LINE_OUT = { mean: 0, variance: 0 }

/** Variance d'un jet uniforme discret de n valeurs dont les dégâts extrêmes diffèrent de `spread`. */
function uniformVar(spread: number, n: number): number {
  return n > 1 ? (spread * spread * (n * n - 1)) / (12 * (n - 1) * (n - 1)) : 0
}

/** La zone touche-t-elle sa propre case d'impact (anneaux, « tout sauf » exclus) ? */
export function zoneHitsCenter(zone: ZoneSpec): boolean {
  const z = compileZone(zone)
  switch (z.shape) {
    case 'O':
    case 'Z':
      return z.radius <= 0
    case 'Q':
    case '#':
    case 'W':
      return false
    case 'C':
    case 'D':
    case 'I':
      return z.minRadius < 1
    default:
      return true
  }
}

/**
 * Espérance et variance (dans `LINE_OUT`) d'une ligne de dégâts de `a` sur `d` (efficacité de zone `eff`, `critPct`
 * en %, 0 si le sort ne peut pas critiquer). Familles : boostée (et × PM restants supposés pleins), fixe, % PV.
 */
export function lineDamage(a: Fighter, d: Fighter, line: DamageLineX, spellId: number, isWeapon: boolean, melee: boolean,
                           eff: number, critPct: number): typeof LINE_OUT {
  LINE_OUT.mean = 0
  LINE_OUT.variance = 0
  const el = resolveElement(line.element, a.stats)
  const c = critPct <= 0 ? 0 : critPct >= 100 ? 1 : critPct / 100
  const mods = receivedMods(d, a, el, melee, isWeapon, MODS)
  if (line.family === 'boosted' || line.family === 'mp') {
    if (el < 0) return LINE_OUT
    const i = INPUT
    const s = a.stats
    i.attacker = s
    i.defender = d.stats
    i.element = el as Element
    i.crit = false
    i.isWeapon = isWeapon
    i.isMelee = melee
    i.defenderIsPlayer = d.kind === 'player'
    i.sustainedPct = mods.sustained
    i.spellPower = s.spellPower ?? 0
    i.extraFixedDamage = spellDamageBonus(a, spellId)
    i.baseDamageBonus = spellBaseDamageBonus(a, spellId)
    i.armorReduction = mods.armor
    i.allResPct = d.stats.allResPct ?? 0
    i.efficiency = eff
    i.areaSteps = undefined
    const combo = s.comboDamagePct ?? 0
    i.portalBonusPct = combo ? combo : undefined
    const pn = prepareDamage(i, PN)
    const muN = rollPrepared(pn, (line.min + line.max) / 2)
    const varN = uniformVar(rollPrepared(pn, line.max) - rollPrepared(pn, line.min), line.max - line.min + 1)
    if (c > 0) {
      i.crit = true
      const pc = prepareDamage(i, PC)
      const muC = rollPrepared(pc, (line.critMin + line.critMax) / 2)
      const varC = uniformVar(rollPrepared(pc, line.critMax) - rollPrepared(pc, line.critMin), line.critMax - line.critMin + 1)
      LINE_OUT.mean = (1 - c) * muN + c * muC
      LINE_OUT.variance = (1 - c) * varN + c * varC + c * (1 - c) * (muC - muN) * (muC - muN)
    } else {
      LINE_OUT.mean = muN
      LINE_OUT.variance = varN
    }
    return LINE_OUT
  }
  // Familles non boostées : jet fixe (résistances de la cible) ou % de PV.
  const spec = DAMAGE_SPECS.get(line.effectId)
  const hp = HP_IN
  hp.defender = d.stats
  hp.element = el
  hp.defenderIsPlayer = d.kind === 'player'
  hp.armorReduction = mods.armor
  hp.allResPct = d.stats.allResPct ?? 0
  hp.efficiency = spec?.noAreaMalus ? 1 : eff
  hp.ignoreResistances = spec?.ignoresRes
  hp.multipliers = undefined
  hp.sustainedPct = mods.sustained
  hp.crit = false
  if (line.family === 'hp' && spec?.hpSource) {
    const sn = HP_SNAP
    sn.casterHp = a.hp
    sn.casterMaxHp = a.maxHp
    sn.casterBaseMaxHp = unerodedMaxHp(a)
    sn.targetHp = d.hp
    sn.targetMaxHp = d.maxHp
    sn.targetBaseMaxHp = unerodedMaxHp(d)
    hp.referenceHp = hpReference(spec.hpSource, sn)
    hp.percent = (line.min + line.max) / 2
  } else {
    hp.percent = 100
    hp.referenceHp = (line.min + line.max) / 2
  }
  const lo = hpBasedDamage(hp)
  LINE_OUT.mean = lo
  LINE_OUT.variance = 0
  return LINE_OUT
}

// ───────────────────────────── un lancer ─────────────────────────────

export interface CastDamage {
  mean: number
  variance: number
}

/** Le sort `p` est-il « de mêlée » (portée max ≤ 1) ? */
export function isMeleeSpell(p: SpellProfileX): boolean {
  return p.maxRange <= 1
}

/** Chance de critique (%) d'un sort pour un lanceur (0 si le niveau n'a pas de liste critique, comme cast.ts). */
export function spellCritPct(a: Fighter, p: SpellProfileX): number {
  if (!p.level.criticalEffects.length) return 0
  return critChance(p.level.critChance, a.stats.critical)
}

/**
 * Dégâts d'UN lancer de `p` par `a` sur `d` placé au centre de la zone (`eff` = efficacité de zone, 1 au centre) :
 * lignes acceptées par le masque, DoT (× min(durée, 2) × 0,8), effets différés (× 0,8).
 */
export function castDamage(a: Fighter, d: Fighter, p: SpellProfileX, isWeapon: boolean, eff = 1, melee = isMeleeSpell(p),
                           out: CastDamage = { mean: 0, variance: 0 }): CastDamage {
  out.mean = 0
  out.variance = 0
  if (!p.damage.length) return out
  const critPct = spellCritPct(a, p)
  for (const line of p.damage) {
    if (eff >= 1 && !zoneHitsCenter(line.zone)) continue
    if (!matchesTargetMask(line.mask, a, d)) continue
    const r = lineDamage(a, d, line, p.spellId, isWeapon, melee, eff, critPct)
    let w = line.p
    if (line.dotTurns > 0) w *= Math.min(line.dotTurns, 2) * 0.8
    else if (line.delayed > 0) w *= 0.8
    out.mean += w * r.mean
    out.variance += w * w * r.variance
  }
  return out
}

// ───────────────────────────── tour complet (sac à dos) ─────────────────────────────

/** 'next' : prochain tour de `a` (relances décrémentées, compteurs remis à zéro) ; 'now' : reste du tour courant. */
export type TurnMode = 'next' | 'now'

export interface TurnDamage {
  mean: number
  variance: number
  /** Sorts lancés par le meilleur tour (ids, avec répétitions). */
  casts: number[]
  apUsed: number
}

const MAX_AP = 24
const DP_MEAN = new Float64Array(MAX_AP + 1)
const DP_VAR = new Float64Array(MAX_AP + 1)
/** Objets du sac à dos (un par lancer possible) : sort, coût, décisions par budget. */
const MAX_ITEMS = 96
const ITEM_SPELL = new Int16Array(MAX_ITEMS)
const ITEM_COST = new Int16Array(MAX_ITEMS)
const DP_TAKE = new Uint8Array(MAX_ITEMS * (MAX_AP + 1))

/** Un sort est-il lançable au tour considéré ? Renvoie le nombre maximal de lancers (0 = indisponible). */
export function castsAvailable(a: Fighter, ks: KnownSpell, p: SpellProfileX, targetId: number, mode: TurnMode): number {
  const cd = a.cooldowns[ks.spellId] ?? 0
  if (mode === 'next' ? cd > 1 : cd > 0) return 0
  let n = Infinity
  if (p.castsPerTurn > 0) n = p.castsPerTurn - (mode === 'now' ? (a.castsThisTurn[ks.spellId] ?? 0) : 0)
  if (p.castsPerTarget > 0) n = Math.min(n, p.castsPerTarget - (mode === 'now' ? (a.castsOnTarget[`${ks.spellId}:${targetId}`] ?? 0) : 0))
  if (p.cooldown > 0) n = Math.min(n, 1)
  return n > 0 ? n : 0
}

/** Entrée du cache des tours (clé effective 64 bits : hash de la Map + `k2`). */
interface TurnEntry { k2: number; r: TurnDamage }

/** Plafonds des caches (vidés en bloc au dépassement : aucune influence sur les décisions). */
const CAST_CACHE_MAX = 40000
const TURN_CACHE_MAX = 60000

export class DptTableImpl implements DptTable {
  readonly profiles: SpellProfileIndexX
  /**
   * Dégâts par lancer : révision de l'attaquant → révision du défenseur → un `CastDamage` par sort (index de
   * `a.spells`), calculé à la demande. Les sorts « % PV » ne sont jamais mis en cache (ils dépendent des PV).
   */
  private readonly castCache = new Map<number, Map<number, (CastDamage | undefined)[]>>()
  private castEntries = 0
  private readonly turnCache = new Map<number, TurnEntry>()
  private readonly bestCache = new Map<number, { k2: number; r: { index: number; mean: number } }>()
  private readonly tmp: CastDamage = { mean: 0, variance: 0 }
  private readonly hpTmp: CastDamage = { mean: 0, variance: 0 }

  constructor(readonly engine: Engine) {
    this.profiles = createSpellProfileIndex(engine)
  }

  calibration(a: Fighter): number {
    return calibrationOf(a)
  }

  /**
   * Dégâts d'un lancer du i-ème sort de `a` sur `d` (au centre, mis en cache par révisions). L'objet renvoyé est
   * partagé (cache) : le lire, ne pas le modifier ; pour un sort « % PV », il est réutilisé à l'appel suivant.
   */
  perCast(a: Fighter, spellIndex: number, d: Fighter): CastDamage {
    const p = this.profiles.ofFighter(a)[spellIndex]
    if (!p || !p.damage.length) return ZERO_CAST
    const ks = a.spells[spellIndex]
    if (hpDependentProfile(p)) {
      castDamage(a, d, p, ks.isWeapon === true, 1, isMeleeSpell(p), this.hpTmp)
      return this.hpTmp
    }
    const ak = damageDigest(a)
    let byD = this.castCache.get(ak)
    if (!byD) this.castCache.set(ak, (byD = new Map()))
    const dk = damageDigest(d)
    let row = byD.get(dk)
    if (!row) {
      if (this.castEntries >= CAST_CACHE_MAX) {
        this.castCache.clear()
        this.castEntries = 0
        this.castCache.set(ak, (byD = new Map()))
      }
      byD.set(dk, (row = new Array(a.spells.length)))
      this.castEntries++
    }
    let r = row[spellIndex]
    if (!r) {
      castDamage(a, d, p, ks.isWeapon === true, 1, isMeleeSpell(p), this.tmp)
      row[spellIndex] = r = { mean: this.tmp.mean, variance: this.tmp.variance }
    }
    return r
  }

  /**
   * Meilleur tour de `a` contre `d` avec `ap` PA (sac à dos borné), non calibré. `filter(i)` restreint les sorts
   * (ex. lançables depuis une case donnée).
   */
  turn(a: Fighter, d: Fighter, ap: number, mode: TurnMode, filter?: (spellIndex: number) => boolean): TurnDamage {
    const apInt = Math.max(0, Math.min(MAX_AP, Math.floor(ap + 1e-9)))
    let h = 0
    let h2 = 0
    if (!filter) {
      // Clé : révisions, PA, mode, relances (et lancers du tour en 'now'), PV si un sort dépend des PV.
      const da = damageDigest(a)
      const dd = damageDigest(d)
      h = fnvInt(fnvInt(fnvInt(0x811c9dc5, da), dd), apInt * 2 + (mode === 'now' ? 1 : 0))
      h2 = fnvInt(fnvInt(fnvInt(0x050c5d1f, da), dd), apInt * 2 + (mode === 'now' ? 1 : 0))
      for (const k in a.cooldowns) {
        const v = a.cooldowns[k]
        if (!v || (mode === 'next' && v <= 1)) continue
        h = fnvInt(fnvInt(h, Number(k)), v)
        h2 = fnvInt(fnvInt(h2, Number(k)), v)
      }
      if (mode === 'now') {
        for (const k in a.castsThisTurn) {
          h = fnvInt(fnvInt(h, Number(k) + 1e6), a.castsThisTurn[k])
          h2 = fnvInt(fnvInt(h2, Number(k) + 1e6), a.castsThisTurn[k])
        }
        const suffix = `:${d.id}`
        for (const k in a.castsOnTarget) {
          const v = a.castsOnTarget[k]
          if (!v || !k.endsWith(suffix)) continue
          h = fnvInt(fnvInt(h, parseInt(k, 10) + 2e6), v)
          h2 = fnvInt(fnvInt(h2, parseInt(k, 10) + 2e6), v)
        }
      }
      if (hpDependent(this.profiles.ofFighter(a))) {
        h = fnvInt(fnvInt(h, a.hp), d.hp)
        h2 = fnvInt(fnvInt(h2, a.hp), d.hp)
      }
      const hit = this.turnCache.get(h)
      if (hit && hit.k2 === h2) return hit.r
    }
    const profiles = this.profiles.ofFighter(a)
    // Sac à dos borné (chaque lancer possible = un objet 0/1), table de décisions pour reconstruire le choix.
    DP_MEAN.fill(0, 0, apInt + 1)
    DP_VAR.fill(0, 0, apInt + 1)
    let nItems = 0
    let freeMean = 0
    let freeVar = 0
    const freeCasts: number[] = []
    for (let i = 0; i < a.spells.length; i++) {
      const p = profiles[i]
      if (!p.damage.length || (filter && !filter(i))) continue
      const ks = a.spells[i]
      let n = castsAvailable(a, ks, p, d.id, mode)
      if (n <= 0) continue
      const cd = this.perCast(a, i, d)
      if (cd.mean <= 0) continue
      const cost = p.apCost
      if (cost <= 0) {
        const k = Number.isFinite(n) ? n : 1
        freeMean += k * cd.mean
        freeVar += k * cd.variance
        for (let j = 0; j < k; j++) freeCasts.push(ks.spellId)
        continue
      }
      n = Math.min(n, Math.floor(apInt / cost))
      const mean = cd.mean
      const variance = cd.variance
      for (let copy = 0; copy < n && nItems < MAX_ITEMS; copy++) {
        const row = nItems * (MAX_AP + 1)
        ITEM_SPELL[nItems] = i
        ITEM_COST[nItems] = cost
        for (let w = 0; w <= apInt; w++) DP_TAKE[row + w] = 0
        for (let w = apInt; w >= cost; w--) {
          const v = DP_MEAN[w - cost] + mean
          if (v > DP_MEAN[w] + 1e-9) {
            DP_MEAN[w] = v
            DP_VAR[w] = DP_VAR[w - cost] + variance
            DP_TAKE[row + w] = 1
          }
        }
        nItems++
      }
    }
    // Plus petit budget atteignant le maximum (PA réellement utilisés), puis reconstruction.
    let best = 0
    for (let w = 1; w <= apInt; w++) if (DP_MEAN[w] > DP_MEAN[best] + 1e-9) best = w
    const casts: number[] = freeCasts
    let apUsed = 0
    let w = best
    for (let it = nItems - 1; it >= 0 && w > 0; it--) {
      if (DP_TAKE[it * (MAX_AP + 1) + w]) {
        casts.push(a.spells[ITEM_SPELL[it]].spellId)
        apUsed += ITEM_COST[it]
        w -= ITEM_COST[it]
      }
    }
    const r: TurnDamage = { mean: DP_MEAN[best] + freeMean, variance: DP_VAR[best] + freeVar, casts, apUsed }
    if (!filter) {
      if (this.turnCache.size >= TURN_CACHE_MAX) this.turnCache.clear()
      this.turnCache.set(h, { k2: h2, r })
    }
    return r
  }

  /** PA du prochain tour de `a` (caractéristique effective actuelle). */
  nextAp(a: Fighter): number {
    return Math.max(0, a.stats.ap)
  }

  dpt(a: Fighter, d: Fighter, ap?: number): number {
    return this.turn(a, d, ap ?? this.nextAp(a), 'next').mean * calibrationOf(a)
  }

  dptVariance(a: Fighter, d: Fighter, ap?: number): number {
    const c = calibrationOf(a)
    return this.turn(a, d, ap ?? this.nextAp(a), 'next').variance * c * c
  }

  /**
   * Plus gros lancer unique (espérance) de `a` sur `d` parmi les sorts disponibles (prochain tour ou reste du tour).
   * Résultat partagé en mode 'next' (cache par empreintes et relances) : le lire immédiatement.
   */
  bestCast(a: Fighter, d: Fighter, mode: TurnMode = 'next'): { index: number; mean: number } {
    let h = 0
    let h2 = 0
    if (mode === 'next') {
      const da = damageDigest(a)
      const dd = damageDigest(d)
      h = fnvInt(fnvInt(0x2545f491, da), dd)
      h2 = fnvInt(fnvInt(0x050c5d1f, da), dd)
      for (const k in a.cooldowns) {
        const v = a.cooldowns[k]
        if (v <= 1) continue
        h = fnvInt(fnvInt(h, Number(k)), v)
        h2 = fnvInt(fnvInt(h2, Number(k)), v)
      }
      if (hpDependent(this.profiles.ofFighter(a))) {
        h = fnvInt(fnvInt(h, a.hp), d.hp)
        h2 = fnvInt(fnvInt(h2, a.hp), d.hp)
      }
      const hit = this.bestCache.get(h)
      if (hit && hit.k2 === h2) return hit.r
    }
    const profiles = this.profiles.ofFighter(a)
    let index = -1
    let mean = 0
    for (let i = 0; i < a.spells.length; i++) {
      const p = profiles[i]
      if (!p.damage.length || castsAvailable(a, a.spells[i], p, d.id, mode) <= 0) continue
      const m = this.perCast(a, i, d).mean
      if (m > mean) {
        mean = m
        index = i
      }
    }
    const r = { index, mean }
    if (mode === 'next') {
      if (this.bestCache.size >= TURN_CACHE_MAX) this.bestCache.clear()
      this.bestCache.set(h, { k2: h2, r })
    }
    return r
  }

  /** Vide les caches (tests, changement de données). */
  clear(): void {
    this.castCache.clear()
    this.castEntries = 0
    this.turnCache.clear()
    this.bestCache.clear()
  }
}

/** Le sort a-t-il une ligne « % PV » (dégâts dépendant des PV du lanceur ou de la cible) ? */
function hpDependentProfile(p: SpellProfileX): boolean {
  let v = HP_DEP_P.get(p)
  if (v === undefined) HP_DEP_P.set(p, (v = p.damage.some(l => l.family === 'hp')))
  return v
}
const HP_DEP_P = new WeakMap<SpellProfileX, boolean>()

const HP_DEP = new WeakMap<readonly SpellProfileX[], boolean>()
/** Un des sorts dépend-il des PV (famille « % PV ») ? */
function hpDependent(list: readonly SpellProfileX[]): boolean {
  let v = HP_DEP.get(list)
  if (v === undefined) HP_DEP.set(list, (v = list.some(p => p.damage.some(l => l.family === 'hp'))))
  return v
}

const ZERO_CAST: CastDamage = Object.freeze({ mean: 0, variance: 0 }) as CastDamage
const TABLES = new WeakMap<Engine, DptTableImpl>()

/** Table DPT d'un moteur (partagée : ses caches sont indexés par révisions, valables dans tous les clones). */
export function createDptTable(engine: Engine): DptTableImpl {
  let t = TABLES.get(engine)
  if (!t) TABLES.set(engine, (t = new DptTableImpl(engine)))
  return t
}
