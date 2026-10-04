/**
 * Marques au sol (docs/research/effects.md §7.9, mechanics.md §13 et §16, vortex.md §7, classes/feca.md §1-3,
 * sram.md §1, huppermage.md §2.2, eliotrope.md §3 ; port OTOMAI `DamageEffectHandler.HandleAdd*`, `ExecuteMarks`,
 * `ExecuteMarkSpell`, `HandleForce*Trigger`, `HandleMarkDispell`, `PortalUtils`).
 *
 * Pose (`diceNum` = sort de la marque, `diceSide` = grade, `value` = couleur, `duration` = durée en tours du poseur,
 * zone de l'effet = cases de la marque centrées sur la case ciblée ; conditions « * » du masque sur le lanceur ;
 * le flag critique de la pose est hérité par le sort de la marque) :
 *  - 400 piège : invisible pour l'adversaire, se déclenche dès qu'un combattant entre dans une de ses cases (marche,
 *    poussée, téléportation) : il disparaît puis son sort est lancé par le poseur, centré sur la case principale, le
 *    combattant déclencheur étant ciblé même hors zone (dommages « de piège », déclencheur DT) ;
 *  - 401 glyphe de début de tour, 402 de fin de tour (4040 glyphe-prison : traité comme 401, INCERTAIN) : au début /
 *    à la fin du tour d'un combattant présent dans la glyphe, son sort est lancé sur lui seul (case principale, ou la
 *    case du combattant si le sort a des effets en zone `P`) ;
 *  - 1165 glyphe « immédiat » : déclenché quand un combattant y entre en marchant (pas par poussée/téléportation, ni à
 *    la pose : le port a désactivé l'exécution à la pose) — glyphes des monstres du Vortex (5012 → 5011) ;
 *  - 1091 glyphe-aura : appliqué une fois à chaque combattant présent à la pose ou qui y entre (même poussé, ou en
 *    apparaissant), lui seul étant ciblé même hors de la zone du sort de l'aura (port : `additionalTarget`) ; ses
 *    buffs directs sont retirés quand il en sort ou quand l'aura disparaît ;
 *  - 2022 rune (inerte) : déclenchée par 2023, puis consommée ; une nouvelle rune remplace celle de la même case ;
 *  - 1181 portail (4 par équipe au plus, le plus ancien disparaît), 1183 désactivation jusqu'au prochain tour du
 *    lanceur, 1182 utilisation ; un combattant qui marche sur un portail actif (≥ 2 portails) est téléporté au portail
 *    de sortie de la chaîne (même règle que les déplacements forcés : movement/portals.ts `travelThrough`).
 * Déclenchements forcés : 1026 glyphes du lanceur issus du sort `value` (0 = tous), 1025 pièges du lanceur ; dissipations
 * 2018 / 2019 / 2024 (glyphes / pièges / runes du lanceur issus du sort `diceNum`, 0 = tous ; le sort comparé est celui
 * qui a posé la marque ou celui qu'elle lance).
 *
 * Les durées des glyphes sont décomptées au début du tour du poseur par Engine (Glyph.remaining) ; les pièges durent
 * jusqu'à leur déclenchement. `installMarks(engine)` chaîne les crochets onEnterCell / onTurnStart / onTurnEnd.
 */
import type { EffectData } from '../../data/model'
import { distance } from '../../map/geometry'
import { isCellInZone, zoneCells } from '../../map/zones'
import type { Engine } from '../engine'
import { casterPassesMask } from '../targetMask'
import type { Fighter, FightState, Glyph, Trap } from '../types'
import { applyEffects, type ApplyOptions, type TriggerEvent } from './core'
import { nearestChain } from './movement/chain'
import { canUsePortal as canTravelThroughPortal, travelThrough } from './movement/portals'
import { registerEffect, type EffectContext } from './registry'

/** Options globales des marques (points INCERTAINS). */
export const markOptions = {
  /** Les pièges se déclenchent aussi sur les alliés du poseur (mechanics.md §13, sram.md §1). */
  trapsTriggeredByAllies: true,
  /** Nombre maximal de portails par équipe (eliotrope.md §3.1, INCERTAIN). */
  maxPortalsPerTeam: 4,
}

/** Profondeur maximale de marques déclenchées en chaîne (port `ExecuteMarks` : recursivityTries < 10). */
const MAX_MARK_CHAIN = 10
let markChain = 0

type GlyphTrigger = Glyph['trigger']

/** Couleur RGB DofusDB (`value`) → « #rrggbb ». */
export function markColor(value: number): string {
  return '#' + ((value >>> 0) & 0xffffff).toString(16).padStart(6, '0')
}

function markEffects(engine: Engine, spellId: number, grade: number, crit: boolean): EffectData[] | undefined {
  const lvl = engine.data.spellLevel(spellId, { grade: grade || undefined })
  if (!lvl) return undefined
  return crit && lvl.criticalEffects.length ? lvl.criticalEffects : lvl.effects
}

/** Cases d'une marque : zone de l'effet de pose centrée sur la case principale (cases de la carte ; port `Mark.CreateMark`). */
function markCells(fight: FightState, effect: EffectData, center: number): number[] {
  const out: number[] = []
  for (const c of zoneCells(effect.zone, center, center)) if (fight.map.cells[c]) out.push(c)
  if (!out.length) out.push(center)
  return out
}

function emitGlyph(engine: Engine, fight: FightState, g: Glyph, added: boolean): void {
  engine.emit(fight, { t: 'glyph', glyph: { uid: g.uid, cells: g.cells, color: g.color, spellId: g.spellId }, added })
}

function emitTrap(engine: Engine, fight: FightState, t: Trap, added: boolean): void {
  engine.emit(fight, { t: 'trap', trap: { uid: t.uid, cells: t.cells, color: t.color, spellId: t.spellId }, added })
}

export function removeGlyph(engine: Engine, fight: FightState, g: Glyph): void {
  const i = fight.glyphs.indexOf(g)
  if (i < 0) return
  fight.glyphs = fight.glyphs.filter(x => x !== g)
  emitGlyph(engine, fight, g, false)
  if (g.trigger === 'aura') clearAuraBuffs(engine, fight, g.uid)
}

export function removeTrap(engine: Engine, fight: FightState, t: Trap): void {
  if (!fight.traps.includes(t)) return
  fight.traps = fight.traps.filter(x => x !== t)
  emitTrap(engine, fight, t, false)
}

/** Le combattant peut-il « voir » ce piège (pièges invisibles pour l'adversaire) ? */
export function isTrapVisibleTo(fight: FightState, t: Trap, viewer: Fighter): boolean {
  if (t.visible) return true
  const team = t.team ?? fight.fighters[t.sourceId]?.team
  return team === viewer.team
}

// ───────────────────────────── exécution d'une marque ─────────────────────────────

/** Le sort de la marque a-t-il un effet en zone ponctuelle `P` (le glyphe vise alors la case du combattant) ? */
function hasPointEffect(effects: EffectData[]): boolean {
  for (const e of effects) if (e.zone.shape === 'P') return true
  return false
}

/**
 * Lance le sort d'une marque (port `ExecuteMarkSpell`) : glyphe déclenché par un combattant ⇒ lui seul est ciblé ;
 * piège ⇒ case principale, déclencheur ciblé même hors zone ; aura ⇒ le combattant qui entre ; sans combattant
 * (déclenchement forcé, rune) ⇒ sort centré sur la case principale.
 */
function executeMark(
  engine: Engine,
  fight: FightState,
  mark: Glyph | Trap,
  kind: 'trap' | 'glyph' | 'aura' | 'rune',
  fighter: Fighter | null,
): void {
  const caster = fight.fighters[mark.sourceId]
  if (!caster || !caster.alive || fight.ended || markChain >= MAX_MARK_CHAIN) return
  const spellId = mark.castSpellId ?? mark.spellId
  const effects = mark.effects
  if (!effects.length) return
  let cell = mark.center
  const opts: ApplyOptions = { mark: { kind, uid: mark.uid, cell: mark.center } }
  if (fighter) {
    opts.trigger = { type: 'MARK', source: fighter } as TriggerEvent
    if (kind === 'glyph') {
      opts.forceTarget = fighter
      if (hasPointEffect(effects)) cell = fighter.cell
    } else if (kind === 'aura') {
      // Port : le combattant qui entre est une cible additionnelle (même hors de la zone du sort, ex. sort en P1 sur
      // la case principale d'une aura en anneau) et les combattants déjà affectés sont écartés ⇒ lui seul.
      opts.forceTarget = fighter
      opts.forceAnywhere = true
    } else if (kind === 'trap') opts.additionalTarget = fighter
  }
  const known = caster.spells.find(s => s.spellId === spellId) ?? null
  markChain++
  try {
    applyEffects(engine, fight, caster, known, spellId, effects, cell, caster.cell >= 0 ? caster.cell : cell, mark.crit ?? false, true, 1, opts)
  } finally {
    markChain--
  }
}

/** Déclenche un piège (il disparaît avant que son sort ne s'exécute). */
export function triggerTrap(engine: Engine, fight: FightState, t: Trap, fighter: Fighter | null): void {
  removeTrap(engine, fight, t)
  if (fight.options.record) {
    const name = engine.data.spell(t.spellId)?.name ?? `Piège ${t.spellId}`
    engine.log(fight, fighter ? `${fighter.name} déclenche ${name}.` : `${name} est déclenché.`)
  }
  executeMark(engine, fight, t, 'trap', fighter)
}

// ───────────────────────────── glyphes-auras ─────────────────────────────

/** Applique l'aura à `f` (une seule fois tant qu'il y reste) et marque ses buffs directs (retirés à la sortie). */
function applyAura(engine: Engine, fight: FightState, g: Glyph, f: Fighter): void {
  if (g.triggered?.includes(f.id)) return
  g.triggered = g.triggered ? [...g.triggered, f.id] : [f.id] // copie : les clones de combat partagent le tableau
  const firstUid = fight.nextUid
  executeMark(engine, fight, g, 'aura', f)
  const spellId = g.castSpellId ?? g.spellId
  for (const b of f.buffs) if (b.uid >= firstUid && b.spellId === spellId && b.sourceId === g.sourceId) b.markUid = g.uid
}

/** Retire les buffs directs d'une aura portés par `f` (sortie de la zone). */
function leaveAura(engine: Engine, fight: FightState, g: Glyph, f: Fighter): void {
  if (g.triggered) g.triggered = g.triggered.filter(id => id !== f.id)
  for (const b of f.buffs.slice()) if (b.markUid === g.uid) engine.removeBuff(fight, f, b.uid)
}

/** Retire de tous les combattants les buffs liés à l'aura `uid` (aura disparue). */
function clearAuraBuffs(engine: Engine, fight: FightState, uid: number): void {
  for (const f of fight.fighters) {
    for (const b of f.buffs.slice()) if (b.markUid === uid) engine.removeBuff(fight, f, b.uid)
  }
}

/**
 * Recalcule les auras : entrée des combattants présents non encore affectés, sortie de ceux qui ont quitté la zone,
 * retrait des buffs d'auras disparues (expirées au début du tour du poseur). Appelé aux débuts de tour (et, sans le
 * balayage des auras disparues, aux fins de tour et à chaque arrivée sur une case) ; utilisable par les autres
 * modules après un déplacement.
 */
export function refreshAuras(engine: Engine, fight: FightState): void {
  updateAuras(engine, fight)
  sweepAuraBuffs(engine, fight)
}

function hasAura(fight: FightState): boolean {
  const gs = fight.glyphs
  for (let i = 0; i < gs.length; i++) if (gs[i].trigger === 'aura') return true
  return false
}

/** Entrées / sorties des auras présentes (sans balayage : une aura retirée par `removeGlyph` nettoie ses buffs). */
function updateAuras(engine: Engine, fight: FightState): void {
  if (!hasAura(fight)) return
  for (const g of fight.glyphs.slice()) {
    if (g.trigger !== 'aura' || !fight.glyphs.includes(g)) continue
    const source = fight.fighters[g.sourceId]
    if (!source?.alive) continue
    for (const f of fight.fighters) {
      if (fight.ended) return
      const inside = f.alive && f.cell >= 0 && g.cells.includes(f.cell)
      const was = g.triggered?.includes(f.id) ?? false
      if (inside && !was) applyAura(engine, fight, g, f)
      else if (!inside && was) leaveAura(engine, fight, g, f)
    }
  }
}

/** Retire les buffs d'auras disparues (la marque a expiré au début du tour du poseur, ou a été retirée). */
function sweepAuraBuffs(engine: Engine, fight: FightState): void {
  for (const f of fight.fighters) {
    if (!f.alive) continue
    const buffs = f.buffs
    for (let i = buffs.length - 1; i >= 0; i--) {
      const b = buffs[i]
      if (b?.markUid === undefined) continue
      let alive = false
      for (const g of fight.glyphs) if (g.uid === b.markUid) alive = true
      if (!alive) engine.removeBuff(fight, f, b.uid)
    }
  }
}

// ───────────────────────────── crochets ─────────────────────────────

/** Arrivée de `f` sur `cell` : pièges, glyphes immédiats (marche), auras, portails (marche). */
export function enterCell(engine: Engine, fight: FightState, f: Fighter, cell: number, opts: { fromDrag?: boolean } = {}): void {
  if (fight.ended || !f.alive || cell < 0 || markChain >= MAX_MARK_CHAIN) return
  // Pièges (dans l'ordre de pose).
  if (fight.traps.length) {
    for (const t of fight.traps.slice()) {
      if (!f.alive || f.cell !== cell || fight.ended) return
      if (!fight.traps.includes(t) || !t.cells.includes(cell)) continue
      if (!markOptions.trapsTriggeredByAllies && (t.team ?? fight.fighters[t.sourceId]?.team) === f.team) continue
      triggerTrap(engine, fight, t, f)
    }
  }
  if (!fight.glyphs.length) return
  for (const g of fight.glyphs.slice()) {
    if (!f.alive || f.cell !== cell || fight.ended) return
    if (!fight.glyphs.includes(g) || !g.cells.includes(cell)) continue
    const type = g.markType ?? 'glyph'
    if (type === 'portal') {
      if (!opts.fromDrag) usePortalAt(engine, fight, f, g)
      continue
    }
    if (type !== 'glyph') continue
    if (g.trigger === 'enter' && !opts.fromDrag) executeMark(engine, fight, g, 'glyph', f)
  }
  if (f.alive && !fight.ended) updateAuras(engine, fight)
}

/** Début du tour de `f` : réactivation des portails qu'il a désactivés, glyphes de début de tour, auras. */
export function marksTurnStart(engine: Engine, fight: FightState, f: Fighter): void {
  if (!fight.glyphs.length) {
    sweepAuraBuffs(engine, fight)
    return
  }
  for (const g of fight.glyphs) if (g.disabledUntil === f.id) g.disabledUntil = undefined
  refreshAuras(engine, fight)
  triggerTurnGlyphs(engine, fight, f, 'turnStart')
}

/** Fin du tour de `f` : glyphes de fin de tour, auras. */
export function marksTurnEnd(engine: Engine, fight: FightState, f: Fighter): void {
  if (!fight.glyphs.length) return
  triggerTurnGlyphs(engine, fight, f, 'turnEnd')
  if (!fight.ended) updateAuras(engine, fight)
}

function triggerTurnGlyphs(engine: Engine, fight: FightState, f: Fighter, trigger: GlyphTrigger): void {
  for (const g of fight.glyphs.slice()) {
    if (!f.alive || fight.ended) return
    if (g.trigger !== trigger || (g.markType ?? 'glyph') !== 'glyph') continue
    if (!fight.glyphs.includes(g) || !g.cells.includes(f.cell)) continue
    executeMark(engine, fight, g, 'glyph', f)
  }
}

const installed = new WeakSet<Engine>()

/**
 * Installe les crochets des marques sur le moteur (idempotent), en conservant les crochets existants : à appeler
 * après `installEffectCore`. Ordre (mechanics.md §9.2) : début de tour = effets différés et buffs TB puis glyphes de
 * début de tour ; fin de tour = buffs TE puis glyphes de fin de tour.
 */
export function installMarks(engine: Engine): void {
  if (installed.has(engine)) return
  installed.add(engine)
  const prevEnter = engine.hooks.onEnterCell
  const prevStart = engine.hooks.onTurnStart
  const prevEnd = engine.hooks.onTurnEnd
  engine.hooks.onEnterCell = (fight, f, cell, opts) => {
    prevEnter?.(fight, f, cell, opts)
    enterCell(engine, fight, f, cell, opts)
  }
  engine.hooks.onTurnStart = (fight, f) => {
    prevStart?.(fight, f)
    if (f.alive && !fight.ended) marksTurnStart(engine, fight, f)
  }
  engine.hooks.onTurnEnd = (fight, f) => {
    prevEnd?.(fight, f)
    if (f.alive && !fight.ended) marksTurnEnd(engine, fight, f)
  }
}

// ───────────────────────────── pose ─────────────────────────────

/** Contrôles communs de pose : conditions du lanceur, case principale marchable, sort de la marque connu. */
function preparePlacement(ctx: EffectContext): { center: number; effects: EffectData[] } | undefined {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return undefined
  const center = ctx.targetCell
  const mc = fight.map.cells[center]
  if (!mc || !mc.walkable) return undefined
  const effects = markEffects(engine, effect.diceNum, effect.diceSide, ctx.crit)
  if (!effects) return undefined
  return { center, effects }
}

function newGlyph(ctx: EffectContext, center: number, effects: EffectData[], trigger: GlyphTrigger, markType: Glyph['markType']): Glyph {
  const { engine, fight, caster, effect } = ctx
  return {
    uid: engine.uid(fight),
    sourceId: caster.id,
    spellId: ctx.spellId,
    cells: markCells(fight, effect, center),
    center,
    remaining: effect.duration === 0 && markType === 'portal' ? -1 : effect.duration,
    effects,
    trigger,
    color: markColor(effect.value),
    markType,
    castSpellId: effect.diceNum,
    castGrade: effect.diceSide,
    crit: ctx.crit,
    team: caster.team,
  }
}

/** 400 : piège (refusé si la case principale porte déjà un piège et que le sort exige une case sans piège). */
function trapHandler(ctx: EffectContext): void {
  const p = preparePlacement(ctx)
  if (!p) return
  const { engine, fight, caster, effect } = ctx
  if (ctx.spell?.level.needFreeTrapCell && fight.traps.some(t => t.center === p.center)) return
  const t: Trap = {
    uid: engine.uid(fight),
    sourceId: caster.id,
    spellId: ctx.spellId,
    center: p.center,
    cells: markCells(fight, effect, p.center),
    effects: p.effects,
    visible: false,
    color: markColor(effect.value),
    castSpellId: effect.diceNum,
    castGrade: effect.diceSide,
    crit: ctx.crit,
    team: caster.team,
  }
  fight.traps.push(t)
  emitTrap(engine, fight, t, true)
}

/** 401 / 402 / 4040 / 1165 : glyphe (début de tour, fin de tour, prison, immédiat). */
function glyphHandler(ctx: EffectContext): void {
  const p = preparePlacement(ctx)
  if (!p) return
  const id = ctx.effect.effectId
  const trigger: GlyphTrigger = id === 402 ? 'turnEnd' : id === 1165 ? 'enter' : 'turnStart'
  const g = newGlyph(ctx, p.center, p.effects, trigger, 'glyph')
  ctx.fight.glyphs.push(g)
  emitGlyph(ctx.engine, ctx.fight, g, true)
}

/** 1091 : glyphe-aura, appliquée immédiatement aux combattants présents (port `ExecuteGlyphOnEveryFighter`). */
function auraHandler(ctx: EffectContext): void {
  const p = preparePlacement(ctx)
  if (!p) return
  const { engine, fight } = ctx
  const g = newGlyph(ctx, p.center, p.effects, 'aura', 'glyph')
  g.triggered = []
  fight.glyphs.push(g)
  emitGlyph(engine, fight, g, true)
  for (const f of fight.fighters) {
    if (fight.ended || !fight.glyphs.includes(g)) break
    if (f.alive && f.cell >= 0 && g.cells.includes(f.cell)) applyAura(engine, fight, g, f)
  }
}

/** 2022 : rune (remplace la rune centrée sur la même case). */
function runeHandler(ctx: EffectContext): void {
  const p = preparePlacement(ctx)
  if (!p) return
  const { engine, fight } = ctx
  for (const old of fight.glyphs.slice()) if (old.markType === 'rune' && old.center === p.center) removeGlyph(engine, fight, old)
  const g = newGlyph(ctx, p.center, p.effects, 'enter', 'rune')
  fight.glyphs.push(g)
  emitGlyph(engine, fight, g, true)
}

// ───────────────────────────── déclenchements forcés / dissipations ─────────────────────────────

/** Marques du lanceur sélectionnées par un effet de zone : interaction avec la case ciblée (forme P), sinon case principale dans la zone. */
function marksInEffectZone<T extends Glyph | Trap>(ctx: EffectContext, marks: readonly T[]): T[] {
  const z = ctx.effect.zone
  const out: T[] = []
  for (const m of marks) {
    if (m.sourceId !== ctx.caster.id) continue
    if (z.shape === 'P' ? m.cells.includes(ctx.targetCell) : isCellInZone(z, m.center, ctx.targetCell, ctx.casterCell)) out.push(m)
  }
  return out
}

/** 1026 : déclenche les glyphes (hors auras) du lanceur issus du sort `value` (0 = tous). */
function forceGlyphHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const glyphs = fight.glyphs.filter(g => (g.markType ?? 'glyph') === 'glyph' && g.trigger !== 'aura' && (effect.value === 0 || g.spellId === effect.value))
  for (const g of marksInEffectZone(ctx, glyphs)) {
    if (fight.ended) break
    if (fight.glyphs.includes(g)) executeMark(engine, fight, g, 'glyph', null)
  }
}

/** 1025 : déclenche les pièges du lanceur dont la case principale est dans la zone. */
function forceTrapHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const z = effect.zone
  for (const t of fight.traps.slice()) {
    if (fight.ended) break
    if (t.sourceId !== caster.id || !fight.traps.includes(t)) continue
    if (!isCellInZone(z, t.center, ctx.targetCell, ctx.casterCell) && !(z.shape === 'P' && t.cells.includes(ctx.targetCell))) continue
    triggerTrap(engine, fight, t, null)
  }
}

/** 2023 : déclenche (et consomme) les runes du lanceur. */
function forceRuneHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const runes = fight.glyphs.filter(g => g.markType === 'rune')
  for (const r of marksInEffectZone(ctx, runes)) {
    if (fight.ended) break
    if (!fight.glyphs.includes(r)) continue
    removeGlyph(engine, fight, r)
    executeMark(engine, fight, r, 'rune', null)
  }
}

function sameSpell(m: Glyph | Trap, spellId: number): boolean {
  return spellId === 0 || m.spellId === spellId || m.castSpellId === spellId
}

/** 2018 / 2019 / 2024 : dissipe les glyphes / pièges / runes du lanceur issus du sort `diceNum` (0 = tous). */
function dispelMarksHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const spellId = effect.diceNum
  if (effect.effectId === 2019) {
    for (const t of fight.traps.slice()) if (t.sourceId === caster.id && sameSpell(t, spellId)) removeTrap(engine, fight, t)
    return
  }
  const type = effect.effectId === 2024 ? 'rune' : 'glyph'
  for (const g of fight.glyphs.slice()) {
    if (g.sourceId === caster.id && (g.markType ?? 'glyph') === type && sameSpell(g, spellId)) removeGlyph(engine, fight, g)
  }
}

// ───────────────────────────── portails ─────────────────────────────

function isPortalActive(g: Glyph): boolean {
  return g.markType === 'portal' && g.disabledUntil === undefined
}

/** Portails actifs d'une équipe. */
export function activePortals(fight: FightState, team: number): Glyph[] {
  return fight.glyphs.filter(g => isPortalActive(g) && g.team === team)
}

/**
 * Chaîne de portails depuis `entry` (port `PortalUtils.GetPortalChainFromPortalCells`, implémentation partagée
 * movement/chain.ts) : portail le plus proche non visité (distance de Manhattan), et ainsi de suite ; égalités
 * départagées par l'angle orienté comme le port. Renvoie les cases SANS l'entrée ; vide si < 2 portails.
 */
export function portalChain(entry: number, portalCells: readonly number[]): number[] {
  return nearestChain(entry, portalCells)
}

/**
 * Portail de sortie depuis le portail d'entrée `entry` (−1 si aucun réseau) : dernier maillon de la chaîne des
 * portails actifs de l'équipe, en sautant ceux qu'occupe un combattant (port `RedefinePortals`, movement/portals.ts).
 */
export function portalExit(fight: FightState, entry: Glyph): number {
  if (!isPortalActive(entry) || entry.team === undefined) return -1
  const chain = portalChain(entry.center, activePortals(fight, entry.team).map(g => g.center))
  for (let i = chain.length - 1; i >= 0; i--) if (!occupied(fight, chain[i])) return chain[i]
  return -1
}

function occupied(fight: FightState, cell: number): boolean {
  for (const f of fight.fighters) if (f.alive && f.cell === cell && f.carriedBy === undefined) return true
  return false
}

/**
 * Bonus (%) d'un sort projeté par le portail `entry` (port `FightContext.GetPortalBonus`) : bonus de base maximal +
 * % par case × somme des distances entre portails successifs de la chaîne.
 */
export function portalBonus(fight: FightState, entry: Glyph): number {
  if (!isPortalActive(entry) || entry.team === undefined) return 0
  const portals = activePortals(fight, entry.team)
  const chain = portalChain(entry.center, portals.map(g => g.center))
  if (!chain.length) return 0
  let sum = 0
  let prev = entry.center
  for (const c of chain) {
    sum += distance(prev, c)
    prev = c
  }
  let base = 0
  let perCell = 0
  for (const g of portals) {
    base = Math.max(base, g.portalBaseBonus ?? 0)
    perCell = Math.max(perCell, g.portalBonusPerCell ?? 0)
  }
  return base + perCell * sum
}

/** Le combattant peut-il emprunter un portail (monstre `canUsePortal`, effet d'état 17 CantUsePortals) ? */
export function canUsePortal(engine: Engine, f: Fighter): boolean {
  return canTravelThroughPortal(engine, f)
}

/**
 * `f` (sur le portail `entry`) l'emprunte : même règle que les déplacements forcés (movement/portals.ts `travelThrough` :
 * sortie hors portails occupés, portails empruntés inactifs pour ce trajet, déclencheurs PT / CPT), puis marques de la
 * case de sortie (arrivée « forcée » : le portail de sortie n'est pas repris).
 */
function usePortalAt(engine: Engine, fight: FightState, f: Fighter, entry: Glyph): boolean {
  if (!isPortalActive(entry)) return false
  const exit = travelThrough(engine, fight, f, entry, [], undefined, false)
  if (exit === undefined) return false
  enterCell(engine, fight, f, exit.center, FROM_DRAG)
  return true
}

const FROM_DRAG = { fromDrag: true }

/** 1181 : pose un portail (le plus ancien de l'équipe disparaît au-delà de la limite ; un portail de la case est remplacé). */
function portalHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const center = ctx.targetCell
  const mc = fight.map.cells[center]
  if (!mc || !mc.walkable) return
  for (const g of fight.glyphs.slice()) if (g.markType === 'portal' && g.center === center) removeGlyph(engine, fight, g)
  const team = fight.glyphs.filter(g => g.markType === 'portal' && g.team === caster.team)
  if (team.length >= markOptions.maxPortalsPerTeam) removeGlyph(engine, fight, team[0])
  const g: Glyph = {
    uid: engine.uid(fight),
    sourceId: caster.id,
    spellId: ctx.spellId,
    cells: [center],
    center,
    remaining: effect.duration > 0 ? effect.duration : -1,
    effects: [],
    trigger: 'enter',
    color: markColor(effect.value || 0x3fa9f5),
    markType: 'portal',
    crit: ctx.crit,
    team: caster.team,
    portalBonusPerCell: effect.diceNum,
    portalBaseBonus: effect.value,
  }
  fight.glyphs.push(g)
  emitGlyph(engine, fight, g, true)
}

/** 1183 : désactive le portail de la case ciblée (forme P) ou tous ceux de l'équipe, jusqu'au prochain tour du lanceur. */
function disablePortalHandler(ctx: EffectContext): void {
  const { fight, caster, effect } = ctx
  for (const g of fight.glyphs) {
    if (g.markType !== 'portal' || g.team !== caster.team) continue
    if (effect.zone.shape === 'P' && !g.cells.includes(ctx.targetCell)) continue
    g.disabledUntil = caster.id
  }
}

/** 1182 : le combattant présent sur le portail (de l'équipe du lanceur) de la case ciblée l'emprunte. */
function usePortalHandler(ctx: EffectContext): void {
  const { engine, fight, caster } = ctx
  const portal = fight.glyphs.find(g => g.markType === 'portal' && g.team === caster.team && g.cells.includes(ctx.targetCell))
  if (!portal) return
  const f = engine.fighterAt(fight, portal.center)
  if (f) usePortalAt(engine, fight, f, portal)
}

// ───────────────────────────── enregistrement ─────────────────────────────

registerEffect(400, 'marks', trapHandler, false)
registerEffect([401, 402, 4040, 1165], 'marks', glyphHandler, false)
registerEffect(1091, 'marks', auraHandler, false)
registerEffect(2022, 'marks', runeHandler, false)
registerEffect(2023, 'marks', forceRuneHandler, false)
registerEffect(1026, 'marks', forceGlyphHandler, false)
registerEffect(1025, 'marks', forceTrapHandler, false)
registerEffect([2018, 2019, 2024], 'marks', dispelMarksHandler, false)
registerEffect(1181, 'marks', portalHandler, false)
registerEffect(1182, 'marks', usePortalHandler, false)
registerEffect(1183, 'marks', disablePortalHandler, false)
