/**
 * Noyau d'exécution des effets de sorts (docs/research/effects.md §2, §6, §10) :
 *  - pré-ciblage de tous les effets avant exécution (zone ∩ masque), positions « avant le sort » ;
 *  - effets aléatoires (random/group : un seul groupe tiré) ;
 *  - effets différés (delay) et buffs déclencheurs (triggers ≠ 'I') posés sur les cibles ;
 *  - déclenchement des buffs sur événements (TB, TE, D…, PD, X, H, EON#…) sans auto-récursion ;
 *  - sous-sorts (effets « lance un sort ») sans coût ni condition de lancer.
 *
 * Les familles d'effets (dégâts, déplacements, buffs, invocations…) s'enregistrent dans registry.ts
 * et ne gèrent que l'application INSTANTANÉE d'un effet ; tout ce qui est différé/déclenché passe ici.
 */
import type { EffectData, SpellLevelData } from '../../data/model'
import { distance } from '../../map/geometry'
import { zoneCells, zoneEfficiency } from '../../map/zones'
import type { Engine } from '../engine'
import { nextRandom } from '../random'
import { compileTargetMask, matchesTargetMask, type MaskContext } from '../targetMask'
import type { Buff, DamageKind, Fighter, FightState, KnownSpell } from '../types'
import { getEffectHandler, noteUnknownEffect, type EffectContext } from './registry'

/** Profondeur maximale de sous-sorts / déclenchements imbriqués. */
export const MAX_DEPTH = 8

// ───────────────────────────── événements déclencheurs ─────────────────────────────

/** Événement subi (ou causé) par un porteur de buffs, confronté aux codes `triggers`. */
export interface TriggerEvent {
  /**
   * Type d'événement : 'TB' | 'TE' (début/fin de tour du porteur), 'D' (dommages subis), 'PD' (poussée subie),
   * 'P' (poussé), 'MA' (attiré), 'M' (déplacé), 'MS' (échangé), 'TP' (téléporté), 'APA' / 'MPA' (perte PA/PM),
   * 'R' (perte de portée), 'H' (soigné), 'X' (mort), 'K' (a tué), 'DIS' (désenvoûté), 'EON' / 'EOFF' (état),
   * 'CC' (coup critique causé), 'CD' (dommages causés), 'CH' (soin donné), 'CS' (bouclier donné), 'CI' (invocation),
   * 'CAPA' / 'CMPA' (retrait tenté), 'CAPAS' / 'CMPAS' (retrait réussi), 'CPD' (poussée causée), 'PO' (déplace une entité),
   * 'CMPU' (un PM utilisé par le porteur).
   */
  type: string
  /** Entité à l'origine de l'événement (attaquant, soigneur, pousseur...). */
  source?: Fighter
  element?: number
  amount?: number
  melee?: boolean
  damageKind?: DamageKind
  isWeapon?: boolean
  stateId?: number
  /** L'événement a tué le porteur. */
  killed?: boolean
}

const triggerCache = new Map<string, string[]>()

export function parseTriggerCodes(triggers: string): string[] {
  let codes = triggerCache.get(triggers)
  if (!codes) {
    codes = triggers
      .split('|')
      .map(s => s.trim())
      .filter(Boolean)
    triggerCache.set(triggers, codes)
  }
  return codes
}

export function isInstant(effect: EffectData): boolean {
  const t = effect.triggers
  return !t || t === 'I'
}

const ELEMENT_LETTER: Record<number, string> = { 0: 'N', 1: 'E', 2: 'F', 3: 'W', 4: 'A' }

/** Le code de déclencheur `code` (ex. 'DM', 'XD', 'EON98', 'CDF') correspond-il à l'événement ? */
export function triggerMatches(rawCode: string, ev: TriggerEvent, holder: Fighter): boolean {
  let code = rawCode
  // Préfixe X : le déclencheur vaut aussi si l'événement tue le porteur ; sans X, pas de déclenchement post-mortem.
  if (code.length > 1 && code[0] === 'X' && code !== 'X') code = code.slice(1)
  else if (ev.killed && code !== 'X' && code !== 'K') return false
  switch (ev.type) {
    case 'TB':
    case 'TE':
    case 'X':
    case 'K':
    case 'H':
    case 'P':
    case 'MA':
    case 'MS':
    case 'TP':
    case 'APA':
    case 'MPA':
    case 'R':
    case 'DIS':
    case 'CC':
    case 'CH':
    case 'CS':
    case 'CI':
    case 'CAPA':
    case 'CMPA':
    case 'CAPAS':
    case 'CMPAS':
    case 'CPD':
    case 'PO':
      if (code === ev.type) return true
      // Être poussé / attiré / téléporté / échangé est aussi « être déplacé ».
      if (code === 'M' && (ev.type === 'P' || ev.type === 'MA' || ev.type === 'MS' || ev.type === 'TP')) return true
      if ((ev.type === 'TB' && code === 'DTB') || (ev.type === 'TE' && code === 'DTE')) return false
      return false
    case 'CMPU':
      return code === 'CCMPARR'
    case 'M':
      return code === 'M'
    case 'EON':
    case 'EOFF':
      return code === `${ev.type}${ev.stateId}` || code === ev.type
    case 'PD':
      return code === 'PD' || code === 'PMD' || code === 'PPD'
    case 'D':
      return damageCodeMatches(code, ev, holder)
    case 'CD': {
      if (!code.startsWith('CD')) return false
      const rest = code.slice(2)
      if (!rest) return true
      if (rest.length === 1) return ELEMENT_LETTER[ev.element ?? -1] === rest
      if (rest === 'M') return ev.melee === true
      if (rest === 'R') return ev.melee === false
      if (rest === 'BA') return !!ev.source && false
      return false
    }
    default:
      return code === ev.type
  }
}

function damageCodeMatches(code: string, ev: TriggerEvent, holder: Fighter): boolean {
  const kind = ev.damageKind ?? 'direct'
  switch (code) {
    case 'D':
      return kind !== 'push'
    case 'DA':
    case 'DE':
    case 'DF':
    case 'DW':
    case 'DN':
      return kind !== 'push' && ELEMENT_LETTER[ev.element ?? -1] === code[1]
    case 'DM':
      return kind !== 'push' && ev.melee === true
    case 'DR':
      return kind !== 'push' && ev.melee === false
    case 'DS':
      return kind === 'direct' && !ev.isWeapon
    case 'DCAC':
      return kind === 'direct' && !!ev.isWeapon
    case 'DG':
      return kind === 'glyph'
    case 'DT':
      return kind === 'trap'
    case 'DI':
      return ev.source?.kind === 'summon'
    case 'DTB':
    case 'DTE':
    case 'DV':
      return kind === 'poison'
    case 'DBA':
      return !!ev.source && ev.source.team === holder.team && ev.source.id !== holder.id
    case 'DBE':
      return !!ev.source && ev.source.team !== holder.team
    default:
      return false
  }
}

/**
 * Déclenche les buffs du porteur correspondant à l'événement. Un buff ne se redéclenche pas
 * pendant sa propre exécution (garde de réentrance) et respecte son nombre max de déclenchements.
 */
export function fireTriggers(engine: Engine, fight: FightState, holder: Fighter, ev: TriggerEvent, depth = 0): void {
  if (depth > MAX_DEPTH || fight.ended) return
  if (!holder.alive && !ev.killed && ev.type !== 'X') return
  const candidates = holder.buffs.filter(b => b.triggers && b.delay <= 0 && !b.firing)
  for (const buff of candidates) {
    if (!holder.buffs.includes(buff) && ev.type !== 'X') continue
    const codes = parseTriggerCodes(buff.triggers!)
    if (!codes.some(c => triggerMatches(c, ev, holder))) continue
    if (buff.maxTriggers !== undefined && (buff.triggerCount ?? 0) >= buff.maxTriggers) continue
    buff.triggerCount = (buff.triggerCount ?? 0) + 1
    buff.firing = true
    try {
      const caster = fight.fighters[buff.sourceId] ?? holder
      executeTriggeredEffect(engine, fight, caster, holder, buff, ev, depth + 1)
    } finally {
      buff.firing = false
    }
    if (fight.ended) return
  }
}

/** Exécute l'effet porté par un buff déclencheur, appliqué au porteur. */
function executeTriggeredEffect(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  holder: Fighter,
  buff: Buff,
  ev: TriggerEvent,
  depth: number,
): void {
  // L'effet déclenché devient un effet instantané (sa propre `duration` s'applique au résultat).
  const effect: EffectData = { ...buff.effect, triggers: 'I', delay: 0 }
  // Pour les codes « causés » (préfixe C), l'événement vient du porteur : la cible naturelle reste le porteur.
  const indirect = true
  const spell = caster.spells.find(s => s.spellId === buff.spellId) ?? null
  runEffect(engine, fight, {
    caster,
    spell,
    spellId: buff.spellId,
    effect,
    targetCell: holder.cell,
    casterCell: caster.cell >= 0 ? caster.cell : holder.cell,
    targets: holder.alive || ev.killed ? [holder] : [],
    efficiency: new Map([[holder.id, 1]]),
    cells: [holder.cell],
    crit: buff.crit ?? false,
    indirect,
    depth,
    trigger: ev,
  })
}

// ───────────────────────────── exécution d'une liste d'effets ─────────────────────────────

interface PreparedEffect {
  effect: EffectData
  cells: number[]
  targets: Fighter[]
  efficiency: Map<number, number>
}

/** Masques dont les cibles sont recalculées au moment de l'effet (et non pré-calculées). */
/** Ciblage tardif : décidé par le masque compilé (U/u/T/W — targetMask.ts `lateTargeting`). */
const LATE_MASK = { test: (mask: string): boolean => compileTargetMask(mask).lateTargeting }

/**
 * Options additionnelles d'une exécution d'effets (marques, sous-sorts, déclenchements) — toutes facultatives ;
 * sans elles, `applyEffects` / `target` se comportent comme avant (ajout de effects/summons|marks|castspell).
 */
export interface ApplyOptions {
  /** Événement déclencheur propagé aux sous-sorts : « source » des 1017/1018/1019, masques O/o. */
  trigger?: TriggerEvent
  /** Seule cible possible si elle est dans la zone (glyphe déclenché par un combattant : `forceTarget` du port). */
  forceTarget?: Fighter
  /**
   * Avec `forceTarget` : la cible forcée est retenue même hors de la zone de l'effet (si elle vérifie le masque).
   * Glyphe-aura (effects/marks.ts) : le port cible le combattant qui entre comme `additionalTarget` et écarte les
   * combattants déjà affectés (`FromGlyphAura` / `TriggeredFighters`), soit lui seul, où qu'il soit dans l'aura.
   */
  forceAnywhere?: boolean
  /** Cible ajoutée même hors zone (combattant qui déclenche un piège : `additionalTarget` du port). */
  additionalTarget?: Fighter
  /** Exécution issue d'une mort (déclencheur X) : le mourant reste lanceur/cible possible (`IsAlive(isFromDeath)`). */
  fromDeath?: boolean
  /** Marque à l'origine de l'exécution (type des dommages indirects, origine des poussées). */
  mark?: EffectContext['mark']
}

/**
 * Entités « apparues » pendant l'exécution en cours (masques U/u : invoquées ou ressuscitées par un effet précédent
 * du même sort ou d'un de ses sous-sorts). Portée = l'appel `applyEffects` le plus externe ; vidé à son entrée.
 */
const appearing: Fighter[] = []
let applyNesting = 0

/** Déclare une entité apparue (invocation, résurrection) pour les masques U/u des effets suivants. */
export function markAppearing(f: Fighter): void {
  if (!appearing.includes(f)) appearing.push(f)
}

export function isAppearing(f: Fighter): boolean {
  return appearing.includes(f)
}

/** Combattant en cours de mort (déclencheurs X : `alive` déjà faux mais encore sur sa case). */
export function isDying(f: Fighter): boolean {
  return !f.alive && f.cell >= 0
}

/** Points d'invocation utilisés par `f` (invocations vivantes portant le tag `summonCost`, cf. effects/summons.ts). */
export function usedSummonSlots(fight: FightState, f: Fighter): number {
  let n = 0
  for (const o of fight.fighters) {
    if (o.alive && o.summonerId === f.id && o.id !== f.id) n += (o.tags.summonCost as number | undefined) ?? 0
  }
  return n
}

let maskFight: FightState | null = null
const BASE_MASK_CONTEXT: MaskContext = {
  isAppearing,
  summonCount: f => (maskFight ? usedSummonSlots(maskFight, f) : 0),
}

/**
 * Applique une liste d'effets (sort, sous-sort, glyphe, piège) sur une cellule cible.
 * Implémente le pré-ciblage, le tirage des effets aléatoires, les effets différés et les buffs déclencheurs.
 */
export function applyEffects(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  spell: KnownSpell | null,
  spellId: number,
  effects: EffectData[],
  cell: number,
  casterCell: number,
  crit: boolean,
  indirect: boolean,
  depth: number,
  opts?: ApplyOptions,
): void {
  if (applyNesting === 0) appearing.length = 0
  applyNesting++
  try {
    applyEffectsInner(engine, fight, caster, spell, spellId, effects, cell, casterCell, crit, indirect, depth, opts)
  } finally {
    applyNesting--
  }
}

function applyEffectsInner(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  spell: KnownSpell | null,
  spellId: number,
  effects: EffectData[],
  cell: number,
  casterCell: number,
  crit: boolean,
  indirect: boolean,
  depth: number,
  opts: ApplyOptions | undefined,
): void {
  if (depth > MAX_DEPTH) return
  const ordered = [...effects].sort((a, b) => a.order - b.order)

  // Tirage aléatoire : un seul groupe d'effets aléatoires est exécuté (probabilité ∝ somme des poids).
  const groupWeights = new Map<number, number>()
  for (const e of ordered) if (e.random > 0) groupWeights.set(e.group || -e.order - 1, (groupWeights.get(e.group || -e.order - 1) ?? 0) + e.random)
  let pickedGroup: number | undefined
  if (groupWeights.size) {
    const total = [...groupWeights.values()].reduce((a, b) => a + b, 0)
    let r = nextRandom(fight) * total
    for (const [g, w] of groupWeights) {
      r -= w
      if (r <= 0) {
        pickedGroup = g
        break
      }
    }
    if (pickedGroup === undefined) pickedGroup = [...groupWeights.keys()].pop()
  }

  // Pré-ciblage (positions au moment du lancer).
  const prepared: PreparedEffect[] = []
  for (const effect of ordered) {
    if (effect.random > 0 && (effect.group || -effect.order - 1) !== pickedGroup) continue
    prepared.push(effect.targetMask && LATE_MASK.test(effect.targetMask) ? { effect, cells: [], targets: [], efficiency: new Map() } : target(engine, fight, caster, effect, cell, casterCell, opts))
  }

  for (const p of prepared) {
    if (fight.ended) break
    if (!caster.alive && depth === 0 && p.effect.effectId !== 0) {
      // Un lanceur mort en cours de sort n'applique plus d'effets (sauf déclenchements de mort gérés ailleurs).
      break
    }
    const late = p.effect.targetMask && LATE_MASK.test(p.effect.targetMask)
    const prep = late ? target(engine, fight, caster, p.effect, cell, casterCell, opts) : p
    // Les cibles mortes ou déplacées hors du jeu entre-temps sont ignorées (sauf le mourant d'un déclenchement X).
    const targets = prep.targets.filter(t => t.alive || (opts?.fromDeath === true && isDying(t)))
    runEffect(engine, fight, {
      trigger: opts?.trigger,
      mark: opts?.mark,
      caster,
      spell,
      spellId,
      effect: p.effect,
      targetCell: cell,
      casterCell,
      cells: prep.cells,
      targets,
      efficiency: prep.efficiency,
      crit,
      indirect,
      depth,
    })
  }
}

/** Jeton U / u isolé dans un masque (entité qui vient d'apparaître). */
const APPEARING_TOKEN = /(^|,)[Uu](,|$)/

/** Ajoute une cible hors zone (C / O / K / U / cible additionnelle) si elle est valide et vérifie le masque. */
function addOutOfArea(
  targets: Fighter[],
  efficiency: Map<number, number>,
  f: Fighter | undefined,
  eff: number,
  mask: string,
  caster: Fighter,
  mctx: MaskContext,
  dying: boolean,
): void {
  if (!f || !(f.alive || (dying && isDying(f))) || targets.includes(f) || !matchesTargetMask(mask, caster, f, mctx)) return
  targets.push(f)
  efficiency.set(f.id, eff)
}

/** Combattant vivant (ou mourant si `dying`) sur une case. */
/** Tampon de marquage des cases d'une zone (réutilisé, remis à zéro après usage). */
const ZONE_MARK = new Uint8Array(560)

function occupantAt(engine: Engine, fight: FightState, c: number, dying: boolean): Fighter | undefined {
  const f = engine.fighterAt(fight, c)
  if (f || !dying) return f
  for (const o of fight.fighters) if (isDying(o) && o.cell === c && o.carriedBy === undefined) return o
  return undefined
}

/**
 * Calcule la zone et les cibles d'un effet. Avec `opts` (ajout effects/summons|marks|castspell) : contexte de masque
 * (O/o = déclencheur, U/u = entités apparues, Q/q = invocations), cibles hors zone du port
 * (`TargetManagement.GetOutOfAreaTarget` : C = lanceur sauf 780, O = déclencheur, K = porté ; cible additionnelle),
 * cible forcée (glyphes) et mourant ciblable (`fromDeath`). Le lanceur `C` hors zone est ajouté dans tous les cas.
 */
export function target(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  effect: EffectData,
  cell: number,
  casterCell: number,
  opts?: ApplyOptions,
): PreparedEffect {
  // Zones « seulement en LdV » : obstacles et entités bloquent depuis le centre de la zone.
  const cells = effect.zone.onlyIfInSight
    ? zoneCells(effect.zone, cell, casterCell, {
        blocksLos: c => !fight.map.cells[c]?.los || (c !== cell && !!engine.fighterAt(fight, c)),
      })
    : zoneCells(effect.zone, cell, casterCell)
  const targets: Fighter[] = []
  const efficiency = new Map<number, number>()
  const dying = opts?.fromDeath === true
  const force = opts?.forceTarget
  maskFight = fight
  const mctx: MaskContext = opts?.trigger?.source ? { ...BASE_MASK_CONTEXT, triggering: opts.trigger.source } : BASE_MASK_CONTEXT
  const mask = effect.targetMask
  // Parcours des COMBATTANTS (et non des cases) : O(cases + combattants) au lieu de O(cases × combattants),
  // décisif pour les zones « toute la carte » (a1, C63) des scripts du Vortex. Même sélection que `occupantAt` :
  // occupant vivant non porté de chaque case, ou mourant si `fromDeath` et la case n'a pas d'occupant vivant.
  const mark = ZONE_MARK
  for (let i = 0; i < cells.length; i++) mark[cells[i]] = 1
  const picked: Fighter[] = []
  for (const f of fight.fighters) {
    if (f.cell < 0 || f.carriedBy !== undefined || !mark[f.cell]) continue
    if (f.alive) picked.push(f)
  }
  if (dying) {
    for (const f of fight.fighters) {
      if (!isDying(f) || f.carriedBy !== undefined || !mark[f.cell]) continue
      if (!picked.some(o => o.cell === f.cell)) picked.push(f)
    }
  }
  for (let i = 0; i < cells.length; i++) mark[cells[i]] = 0
  // Ordre des cases de la zone conservé (tri final par distance de toute façon).
  if (picked.length > 1) {
    const order = new Map<number, number>()
    for (let i = 0; i < cells.length; i++) if (!order.has(cells[i])) order.set(cells[i], i)
    picked.sort((a, b) => (order.get(a.cell) ?? 0) - (order.get(b.cell) ?? 0))
  }
  for (const f of picked) {
    if (force && f !== force) continue
    if (!matchesTargetMask(mask, caster, f, mctx)) continue
    targets.push(f)
    efficiency.set(f.id, zoneEfficiency(effect.zone, cell, f.cell, casterCell))
  }
  if (mask) {
    const m = compileTargetMask(mask)
    // Masque U/u sur une zone ponctuelle : l'entité qui vient d'apparaître est la cible, où qu'elle soit (port).
    if (appearing.length && effect.zone.shape === 'P' && APPEARING_TOKEN.test(mask)) {
      targets.length = 0
      for (const f of appearing) addOutOfArea(targets, efficiency, f, 1, mask, caster, mctx, dying)
    }
    if (m.addsCaster && effect.effectId !== 780) addOutOfArea(targets, efficiency, caster, 1, mask, caster, mctx, dying)
    if (m.addsTriggering) addOutOfArea(targets, efficiency, opts?.trigger?.source, 1, mask, caster, mctx, dying)
    if (m.addsCarried && caster.carrying !== undefined) addOutOfArea(targets, efficiency, fight.fighters[caster.carrying], 1, mask, caster, mctx, dying)
  }
  if (opts?.additionalTarget && !force) {
    const f = opts.additionalTarget
    addOutOfArea(targets, efficiency, f, f.cell >= 0 ? zoneEfficiency(effect.zone, cell, f.cell, casterCell) : 1, mask, caster, mctx, dying)
  }
  if (force && opts?.forceAnywhere === true) {
    addOutOfArea(targets, efficiency, force, force.cell >= 0 ? zoneEfficiency(effect.zone, cell, force.cell, casterCell) : 1, mask, caster, mctx, dying)
  }
  targets.sort((a, b) => distance(cell, a.cell) - distance(cell, b.cell) || a.id - b.id)
  return { effect, cells, targets, efficiency }
}

export interface RunEffectArgs extends Omit<EffectContext, 'engine' | 'fight'> {
  trigger?: TriggerEvent
}

/**
 * Exécute UN effet : instantané (handler), différé (buff à retardement) ou déclencheur (buff réactif).
 */
export function runEffect(engine: Engine, fight: FightState, a: RunEffectArgs): void {
  const effect = a.effect
  if (effect.delay > 0) {
    for (const t of a.targets) {
      engine.addBuff(fight, t, {
        sourceId: a.caster.id,
        spellId: a.spellId,
        effect,
        value: 0,
        remaining: effect.delay,
        delay: effect.delay,
        dispellable: effect.dispellable === 1,
        kind: 'delayed',
        crit: a.crit,
        label: `Effet différé (${effect.delay} tour${effect.delay > 1 ? 's' : ''})`,
        // Case ciblée par le lancer d'origine (ajout effects/castspell : 2794 / 2960 différés, port `HandleDelayedCast`).
        targetCell: a.originCell ?? a.targetCell,
      })
    }
    return
  }
  if (!isInstant(effect)) {
    const turns = effect.triggerDuration ?? effect.duration
    for (const t of a.targets) {
      // Pas de « +1 tour » pour les buffs TB : c'est un artefact du décompte OTOMAI (effects.md, vérification).
      const bonus = 0
      engine.addBuff(fight, t, {
        sourceId: a.caster.id,
        spellId: a.spellId,
        effect,
        value: 0,
        remaining: turns === 0 ? 1 : turns < 0 ? -1 : turns + bonus,
        delay: 0,
        dispellable: effect.dispellable === 1,
        triggers: effect.triggers,
        kind: 'trigger',
        crit: a.crit,
        maxTriggers: isCastSpellEffect(effect.effectId) && effect.value > 0 && effect.value < 999 ? effect.value : undefined,
        label: `Déclencheur ${effect.triggers}`,
      })
    }
    return
  }
  const entry = getEffectHandler(effect.effectId)
  if (!entry) {
    // E5 : compteur par combat, sauf pour un effet purement visuel (`clientOnly`) qui ne change pas l'état.
    noteUnknownEffect(effect.effectId, effect.clientOnly ? undefined : fight)
    return
  }
  const ctx: EffectContext = { engine, fight, ...a }
  entry.handler(ctx)
}

/** Effets « lance un sort » (docs/research/effects.md §2.5). */
export const CAST_SPELL_EFFECTS = new Set([792, 793, 1017, 1018, 1019, 1160, 2017, 2160, 2792, 2793, 2794, 2795, 2960])

export function isCastSpellEffect(effectId: number): boolean {
  return CAST_SPELL_EFFECTS.has(effectId)
}

/** Options d'un sous-sort (ajout effects/castspell|summons|marks) : en plus d'`ApplyOptions`. */
export interface SubSpellOptions extends ApplyOptions {
  /** Niveau de sort déjà résolu (ex. sort de départ d'un monstre, par id de spell-level) : ignore spellId/grade. */
  level?: SpellLevelData
}

/**
 * Lance un sous-sort sans coût ni condition (portée, LdV). Le flag critique est hérité.
 * `opts` (facultatif) : déclencheur propagé, cible forcée/additionnelle, marque, exécution issue d'une mort
 * (`fromDeath` : un lanceur mourant peut encore lancer, cf. déclencheurs X).
 */
export function castSubSpell(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  spellId: number,
  grade: number,
  cell: number,
  crit: boolean,
  depth: number,
  opts?: SubSpellOptions,
): boolean {
  if (depth > MAX_DEPTH || cell < 0) return false
  if (!caster.alive && !(opts?.fromDeath === true && isDying(caster))) return false
  const lvl: SpellLevelData | undefined = opts?.level ?? engine.data.spellLevel(spellId, { grade: grade || undefined })
  if (!lvl) return false
  const effects = crit && lvl.criticalEffects.length ? lvl.criticalEffects : lvl.effects
  const known = caster.spells.find(s => s.spellId === spellId) ?? null
  if (fight.options.record && depth <= 2) {
    const name = engine.data.spell(spellId)?.name
    if (name) engine.log(fight, `${caster.name} déclenche ${name}.`)
  }
  applyEffects(engine, fight, caster, known, spellId, effects, cell, caster.cell >= 0 ? caster.cell : cell, crit, true, depth + 1, opts)
  return true
}

/**
 * Active les effets différés lancés par `caster` dont le délai arrive à échéance (appelé au début de son tour).
 */
export function resolveDelayedEffects(engine: Engine, fight: FightState, caster: Fighter): void {
  for (const holder of fight.fighters) {
    if (!holder.alive) continue
    for (const b of holder.buffs.slice()) {
      if (b.kind !== 'delayed' || b.sourceId !== caster.id || b.delay > 0) continue
      engine.removeBuff(fight, holder, b.uid)
      runEffect(engine, fight, {
        caster,
        spell: caster.spells.find(s => s.spellId === b.spellId) ?? null,
        spellId: b.spellId,
        effect: { ...b.effect, delay: 0 },
        targetCell: holder.cell,
        casterCell: caster.cell,
        cells: [holder.cell],
        targets: [holder],
        efficiency: new Map([[holder.id, 1]]),
        crit: b.crit ?? false,
        indirect: false,
        depth: 1,
        originCell: b.targetCell,
      })
      if (fight.ended) return
    }
  }
}

/** Installe les points d'extension du noyau d'effets sur le moteur (déclencheurs de tour, dégâts, morts). */
export function installEffectCore(engine: Engine): void {
  const prevStart = engine.hooks.onTurnStart
  const prevEnd = engine.hooks.onTurnEnd
  const prevDamaged = engine.hooks.onDamaged
  engine.hooks.onTurnStart = (fight, f) => {
    prevStart?.(fight, f)
    resolveDelayedEffects(engine, fight, f)
    if (f.alive) fireTriggers(engine, fight, f, { type: 'TB' })
  }
  engine.hooks.onTurnEnd = (fight, f) => {
    if (f.alive) fireTriggers(engine, fight, f, { type: 'TE' })
    prevEnd?.(fight, f)
  }
  engine.hooks.onDamaged = (fight, target, source, amount, info) => {
    prevDamaged?.(fight, target, source, amount, info)
    const killed = !target.alive
    fireTriggers(engine, fight, target, {
      type: info?.kind === 'push' ? 'PD' : 'D',
      source,
      amount,
      element: info?.element,
      melee: info?.melee,
      damageKind: info?.kind,
      isWeapon: info?.isWeapon,
      killed,
    })
    if (source && source.alive) {
      fireTriggers(engine, fight, source, {
        type: info?.kind === 'push' ? 'CPD' : 'CD',
        source,
        amount,
        element: info?.element,
        melee: info?.melee,
        damageKind: info?.kind,
      })
    }
  }
  engine.trigger = (fight, holder, ev) => fireTriggers(engine, fight, holder, ev)
}
