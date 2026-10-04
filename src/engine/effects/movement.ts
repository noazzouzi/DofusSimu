/**
 * Famille « déplacements » (kind `movement` de data/research/effect-semantics.json + portage) : poussées,
 * attirances, téléportations, échanges, symétries, retours dans le temps, porter / jeter, passage des portails.
 * Règles : docs/research/mechanics.md §15-16, effects.md §7.6, port D3 `PushUtils` / `Teleport` (détails dans
 * movement/drag.ts, movement/teleport.ts, movement/carry.ts, movement/portals.ts).
 *
 *  | id | comportement |
 *  |---|---|
 *  | 5 | repousse de diceNum (dommages de collision) — cibles de la plus éloignée à la plus proche |
 *  | 1021 | repousse de diceNum, forcé (ignore les immunités, sans collision) |
 *  | 1103 | repousse de diceNum sans dommages |
 *  | 6 / 1022 | attire de diceNum (1022 : forcé) — sans dommages |
 *  | 1041 | le lanceur recule de diceNum à l'opposé de la cible (collision) |
 *  | 1042 | le lanceur avance de diceNum vers la cible |
 *  | 783 | pousse l'entité adjacente au lanceur (vers la case ciblée) jusqu'à la case ciblée |
 *  | 1043 | attire la 1re entité de la ligne lanceur → case ciblée jusqu'à la case ciblée |
 *  | 4 | téléporte le lanceur sur la case ciblée (ligne `l` stopAtTarget : case libre la plus proche de la cible) |
 *  | 8 / 1023 | échange lanceur ↔ cible (1023 : forcé) |
 *  | 784 / 1099 / 1100 | retour à la case de début de combat / de début de tour / précédente |
 *  | 1101 | la cible prend la place du lanceur (échange) |
 *  | 1104 / 1105 / 1106 | symétries : lanceur / cible autour de la case ciblée / du lanceur / cibles autour de l'impact |
 *  | 50 / 51 | porter / jeter (Pandawa) |
 *  | 2184 | la cible rejoint une case adjacente au lanceur (Laisse Spirituelle, INCERTAIN) |
 *
 * Portails (1181 / 1182 / 1183, marche) : effects/marks.ts. Un déplacement FORCÉ qui arrive sur un portail actif
 * l'emprunte (movement/portals.ts ; une poussée continue depuis la sortie avec la force restante).
 * Les effets `forClientOnly` (« info-bulle uniquement ») ne sont pas appliqués (voir `register`).
 *
 * `installMovement(engine)` doit être appelé à la création du moteur (comme `installEffectCore`) : il enregistre
 * les cases de début de combat / de tour (784, 1099) et réinitialise les marqueurs T / W.
 */
import { cellInDirection, directionBetween, distance, neighborsOf } from '../../map/geometry'
import type { Engine } from '../engine'
import { casterPassesMask, matchesTargetMask } from '../targetMask'
import type { Fighter, FightState } from '../types'
import { carryFighter, throwCarried } from './movement/carry'
import { cantBeMoved, cellOf, enterCell, FAMILY, fireMoveTriggers, initPositions, isFreeCell, relocate } from './movement/common'
import { comparePositions, dragFighter, pullDirection, pushDirection } from './movement/drag'
import { teleportFighter, teleportToCell } from './movement/teleport'
import { registerEffect, type EffectContext } from './registry'

export { canBePushed, collisionDamage, comparePositions, dragFighter, pullDirection, pushDirection } from './movement/drag'
export { canSwitchPosition, canTeleport, mirrorCell, teleportDestination, teleportFighter } from './movement/teleport'
export { carryFighter, releaseCarried, throwCarried } from './movement/carry'
export { canUsePortal, portalAt, portalExit, travelThrough } from './movement/portals'
export { previousCell, startCell, turnStartCell } from './movement/common'

// ───────────────────────────── enregistrement (effets « info-bulle ») ─────────────────────────────

/**
 * Enregistre un interprète de la famille. Les effets `forClientOnly` (ligne affichée d'un sort dont le vrai
 * déplacement est porté par un sous-sort, ex. 1041 / 4 de *Comète*, 5 de *Cascade*, 1099 de *Rembobinage*, 1106 de
 * *Balestra* — 116 effets de déplacement dans les données) sont ignorés, comme dans les familles buffs et dégâts :
 * les appliquer doublerait (ou contredirait) le déplacement du sous-sort.
 */
function register(ids: number | number[], handler: (ctx: EffectContext) => void, perTarget = true): void {
  registerEffect(
    ids,
    FAMILY,
    ctx => {
      if (!ctx.effect.clientOnly) handler(ctx)
    },
    perTarget,
  )
}

// ───────────────────────────── marqueurs T / W par lancer ─────────────────────────────

/**
 * Les masques T (téléfragué) et W (téléporté sur une case invalide) valent pour le lancer en cours, sous-sorts compris
 * (port : `PendingEffects` de l'exécution du sort). Un lancer de premier niveau est repéré par le nombre total de sorts
 * lancés depuis le début du tour (`castSpell` incrémente `castsThisTurn` du lanceur avant d'appliquer les effets ; les
 * sous-sorts, déclenchements et marques ne le modifient pas ; il ne peut que croître pendant un tour) : au premier
 * effet de déplacement d'un NOUVEAU lancer — quelle que soit sa profondeur (ex. 1099 du sous-sort de *Rembobinage*
 * suivi de 2160 « T ») — les marqueurs du lancer précédent sont effacés (ils le sont aussi à chaque début de tour).
 * Sans allocation (chemin critique de l'IA).
 */
interface CastGeneration {
  round: number
  turn: number
  casts: number
}

const lastCast = new WeakMap<FightState, CastGeneration>()

/** Nombre de sorts lancés ce tour (compteurs `castsThisTurn` de tous les combattants). */
function castsThisTurn(fight: FightState): number {
  let n = 0
  const fs = fight.fighters
  for (let i = 0; i < fs.length; i++) {
    const casts = fs[i].castsThisTurn
    for (const k in casts) n += casts[k]
  }
  return n
}

function clearCastMarkers(fight: FightState): void {
  for (const f of fight.fighters) {
    if (f.tags.telefragged) f.tags.telefragged = false
    if (f.tags.teleportedInvalid) f.tags.teleportedInvalid = false
  }
}

function beginMovementEffect(ctx: EffectContext): void {
  const fight = ctx.fight
  const round = fight.round
  const turn = fight.turnIndex
  const casts = castsThisTurn(fight)
  const g = lastCast.get(fight)
  if (g === undefined) lastCast.set(fight, { round, turn, casts })
  else if (g.round === round && g.turn === turn && g.casts === casts) return
  else {
    g.round = round
    g.turn = turn
    g.casts = casts
  }
  clearCastMarkers(fight)
}

/** Lancer (au sens « cast ») où un portage a eu lieu (garde du jet, voir `throwEffect`). */
function castStamp(ctx: EffectContext): string {
  const c = ctx.caster
  return `${ctx.fight.round}|${ctx.fight.turnIndex}|${c.id}|${ctx.spellId}|${c.castsThisTurn[ctx.spellId] ?? 0}`
}

// ───────────────────────────── poussées / attirances ─────────────────────────────

/** Case d'origine des poussées : case principale de la marque, sinon case du lanceur AVANT le sort. */
function pushSource(ctx: EffectContext): number {
  return ctx.mark !== undefined ? ctx.mark.cell : ctx.casterCell
}

/** Origine des attirances : case principale de la marque, sinon case ACTUELLE du lanceur (port `Pull`). */
function pullSource(ctx: EffectContext): number {
  return ctx.mark !== undefined ? ctx.mark.cell : ctx.caster.cell
}

// Tri des cibles dans l'ordre du port (`comparePositions`) : comparateurs statiques (pas de fermeture par appel).
let orderRef = -1
const PUSH_ORDER = (a: Fighter, b: Fighter): number => comparePositions(orderRef, true, a.cell, b.cell)
const PULL_ORDER = (a: Fighter, b: Fighter): number => comparePositions(orderRef, false, a.cell, b.cell)

/**
 * Cibles dans l'ordre d'application du port : de la plus éloignée à la plus proche de la case ciblée pour une poussée
 * (5, 1021, 1103, 1041), l'inverse pour une attirance (6, 1022, 1042) ; égalités départagées par la direction.
 */
function orderedTargets(ctx: EffectContext, push: boolean): Fighter[] {
  const t = ctx.targets
  if (t.length > 1) {
    orderRef = ctx.targetCell
    t.sort(push ? PUSH_ORDER : PULL_ORDER)
  }
  return t
}

function push(ctx: EffectContext): void {
  beginMovementEffect(ctx)
  const id = ctx.effect.effectId
  const opts = { forced: id === 1021, collision: id === 5 }
  for (const t of orderedTargets(ctx, true)) {
    if (!t.alive || ctx.fight.ended) continue
    const dir = pushDirection(pushSource(ctx), ctx.targetCell, t.cell)
    dragFighter(ctx.engine, ctx.fight, ctx.caster, t, ctx.effect.diceNum, dir, opts)
  }
}

function pull(ctx: EffectContext): void {
  beginMovementEffect(ctx)
  const opts = { forced: ctx.effect.effectId === 1022, pull: true }
  for (const t of orderedTargets(ctx, false)) {
    if (!t.alive || ctx.fight.ended) continue
    const dir = pullDirection(pullSource(ctx), ctx.targetCell, t.cell)
    dragFighter(ctx.engine, ctx.fight, ctx.caster, t, ctx.effect.diceNum, dir, opts)
  }
}

/** 1041 : le lanceur recule à l'opposé de chaque cible (dommages de collision possibles). */
function casterPushedBack(ctx: EffectContext): void {
  beginMovementEffect(ctx)
  const caster = ctx.caster
  for (const t of orderedTargets(ctx, true)) {
    if (!caster.alive || ctx.fight.ended) return
    if (t === caster) continue
    const src = ctx.mark !== undefined ? ctx.mark.cell : t.cell
    const dir = pushDirection(src, ctx.targetCell, ctx.casterCell)
    dragFighter(ctx.engine, ctx.fight, caster, caster, ctx.effect.diceNum, dir, { collision: true })
  }
}

/** 1042 : le lanceur avance vers chaque cible. */
function casterPulledForward(ctx: EffectContext): void {
  beginMovementEffect(ctx)
  const caster = ctx.caster
  for (const t of orderedTargets(ctx, false)) {
    if (!caster.alive || ctx.fight.ended) return
    if (t === caster) continue
    const src = ctx.mark !== undefined ? ctx.mark.cell : t.cell
    const dir = pullDirection(src, ctx.targetCell, ctx.casterCell)
    dragFighter(ctx.engine, ctx.fight, caster, caster, ctx.effect.diceNum, dir, { pull: true })
  }
}

/** `FightContext.GetFightersUpTo` : première entité de la ligne `from` → `dir`, entre `minRange` et `maxRange`. */
function fighterUpTo(engine: Engine, fight: FightState, from: number, dir: number, minRange: number, maxRange: number): Fighter | undefined {
  if (dir < 0) return undefined
  let cell = from
  for (let d = 1; d <= Math.max(1, maxRange); d++) {
    cell = cellInDirection(cell, dir)
    if (cell < 0) return undefined
    if (d < minRange) continue
    const f = engine.fighterAt(fight, cell)
    if (f !== undefined && f.alive) return f
  }
  return undefined
}

/** 783 : pousse l'entité adjacente au lanceur (en direction de la case ciblée) jusqu'à la case ciblée, sans dommages. */
function pushUpTo(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (!casterPassesMask(effect.targetMask, caster)) return
  beginMovementEffect(ctx)
  const dir = directionBetween(caster.cell, ctx.targetCell)
  const t = fighterUpTo(engine, fight, caster.cell, dir, 1, 1)
  if (t === undefined || !matchesTargetMask(effect.targetMask, caster, t)) return
  const dist = distance(ctx.targetCell, t.cell)
  const pdir = pushDirection(ctx.casterCell, ctx.casterCell, t.cell)
  dragFighter(engine, fight, caster, t, dist, pdir, {})
}

/** 1043 : attire la première entité de la ligne lanceur → case ciblée (dans la portée du sort) jusqu'à la case ciblée. */
function pullUpTo(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (!casterPassesMask(effect.targetMask, caster)) return
  beginMovementEffect(ctx)
  const dir = directionBetween(caster.cell, ctx.targetCell)
  const lvl = ctx.spell?.level
  const minRange = lvl ? lvl.minRange : 1
  const maxRange = lvl ? lvl.range + (lvl.rangeBoostable ? caster.stats.range : 0) : 63
  const t = fighterUpTo(engine, fight, caster.cell, dir, minRange, maxRange)
  if (t === undefined || !matchesTargetMask(effect.targetMask, caster, t)) return
  const dist = distance(ctx.targetCell, t.cell)
  const pdir = pullDirection(caster.cell, ctx.casterCell, t.cell)
  dragFighter(engine, fight, caster, t, dist, pdir, { pull: true })
}

// ───────────────────────────── téléportations ─────────────────────────────

/** Jeton d'inclusion d'un masque (lettre seule, sans '*' : a, A, g, c, C, h, l, m, i, j, s, d, x...). */
const INCLUSION_TOKEN = /^[aAgcChHlLdDmMiIjJsSx]$/
const SELF_MASKS = new Map<string, string>()

/**
 * Masque du lanceur pour l'effet 4 : « C » + toutes les conditions du masque d'origine (cache par chaîne). Les lettres
 * d'inclusion sont ignorées (le déplacé est toujours le lanceur, même pour un masque « A » de monstre), mais les
 * conditions de cible s'appliquent au lanceur : *Comète* (sous-sort 32706) téléporte avec « a,A,*e7,e7027 »
 * seulement si le lanceur n'a pas l'état 7027 (« au contact »), sinon il recule (1041 « *E7027 »).
 */
function selfMask(mask: string): string {
  let s = SELF_MASKS.get(mask)
  if (s === undefined) {
    s = 'C'
    for (const raw of mask.split(',')) {
      const tok = raw.trim()
      if (tok && !INCLUSION_TOKEN.test(tok)) s += ',' + tok
    }
    SELF_MASKS.set(mask, s)
  }
  return s
}

/**
 * 4 : le déplacé est toujours le lanceur (port `TargetManagement` / `Teleport` : cible forcée au lanceur hors zone
 * ponctuelle, `casterOrFighter = caster`), s'il vérifie les conditions du masque (`*` et conditions de cible, voir
 * `selfMask` ; écart assumé avec le port, qui ignore les conditions de cible hors zone ponctuelle et exige une cible
 * sélectionnée en zone ponctuelle — les sorts de monstres « A » sur case libre ne téléporteraient jamais).
 */
function teleportSelf(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (!caster.alive || !matchesTargetMask(selfMask(effect.targetMask), caster, caster)) return
  beginMovementEffect(ctx)
  teleportToCell(engine, fight, caster, caster, ctx.targetCell, effect.zone)
}

function teleportEach(ctx: EffectContext): void {
  beginMovementEffect(ctx)
  const id = ctx.effect.effectId
  for (const t of ctx.targets) {
    if (ctx.fight.ended) return
    if (!t.alive) continue
    teleportFighter(ctx.engine, ctx.fight, ctx.caster, t, id, ctx.targetCell, ctx.effect.zone)
  }
}

/** 2184 : la cible rejoint la case libre adjacente au lanceur la plus proche d'elle (INCERTAIN). */
function followCaster(ctx: EffectContext): void {
  const { engine, fight, caster } = ctx
  if (!caster.alive) return
  beginMovementEffect(ctx)
  const around = cellOf(fight, caster)
  for (const t of ctx.targets) {
    if (t === caster || !t.alive || t.carriedBy !== undefined || distance(t.cell, around) <= 1) continue
    if (cantBeMoved(engine, t)) continue
    let best = -1
    for (const n of neighborsOf(around)) {
      if (!isFreeCell(engine, fight, n)) continue
      if (best < 0 || distance(n, t.cell) < distance(best, t.cell)) best = n
    }
    if (best < 0) continue
    relocate(engine, fight, t, best)
    enterCell(engine, fight, t, best)
    fireMoveTriggers(engine, fight, t, 'M', caster)
  }
}

// ───────────────────────────── porter / jeter ─────────────────────────────

/** Lancer (au sens « cast ») où le portage a eu lieu : un jet du MÊME lancer est ignoré (pré-ciblage, `*E3`). */
function carryStamp(ctx: EffectContext): string {
  return `${castStamp(ctx)}|${ctx.depth}`
}

function carry(ctx: EffectContext): void {
  for (const t of ctx.targets) {
    if (ctx.caster.carrying !== undefined) return
    if (carryFighter(ctx.engine, ctx.fight, ctx.caster, t, ctx.spellId)) ctx.caster.tags.carryStamp = carryStamp(ctx)
  }
}

/**
 * 51 : jette l'entité portée sur la case ciblée. Port : le porté est une cible hors zone de l'effet (filtrée par le
 * masque). Les conditions `*` du masque sont évaluées au début du lancer : un portage effectué par ce même lancer
 * (Karcham : porter puis « jeter si Porteur ») n'est pas jeté.
 */
function throwEffect(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (caster.carrying === undefined || !caster.alive) return
  if (caster.tags.carryStamp === carryStamp(ctx)) return
  const carried = fight.fighters[caster.carrying]
  if (carried === undefined) return
  if (!ctx.targets.includes(carried) && !matchesTargetMask(effect.targetMask, caster, carried)) return
  beginMovementEffect(ctx)
  throwCarried(engine, fight, caster, ctx.targetCell, caster)
}

// ───────────────────────────── enregistrement ─────────────────────────────

register([5, 1021, 1103], push)
register([6, 1022], pull)
register(1041, casterPushedBack)
register(1042, casterPulledForward)
register(783, pushUpTo, false)
register(1043, pullUpTo, false)
register(4, teleportSelf, false)
register([8, 1023, 784, 1099, 1100, 1101, 1104, 1105, 1106], teleportEach)
register(2184, followCaster)
register(50, carry)
register(51, throwEffect, false)

/** Identifiants d'effets gérés par cette famille. */
export const MOVEMENT_EFFECT_IDS: readonly number[] = [
  4, 5, 6, 8, 50, 51, 783, 784, 1021, 1022, 1023, 1041, 1042, 1043, 1099, 1100, 1101, 1103, 1104, 1105, 1106, 2184,
]

// ───────────────────────────── points d'extension ─────────────────────────────

const installed = new WeakSet<Engine>()

/**
 * Installe les crochets de la famille sur un moteur (idempotent) : au début du tour de `f`, cases de début de
 * combat manquantes (784), case de début de tour de `f` (1099) et effacement des marqueurs T / W. À appeler avant
 * le premier tour (sinon 784 ignore les marches déjà faites).
 */
export function installMovement(engine: Engine): void {
  if (installed.has(engine)) return
  installed.add(engine)
  const prevStart = engine.hooks.onTurnStart
  engine.hooks.onTurnStart = (fight, f) => {
    initPositions(fight)
    f.tags.turnStartCell = cellOf(fight, f)
    clearCastMarkers(fight)
    lastCast.delete(fight)
    prevStart?.(fight, f)
  }
}
