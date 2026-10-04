/**
 * Invocations et résurrections (docs/research/effects.md §7.8 et §11, mechanics.md §11, vortex.md §6 ; port OTOMAI
 * `DamageEffectHandler.HandleSummoningWithoutTarget`, `DamageCalculator.Summon`, `FightContext.GetLastKilledAlly`) :
 *
 *  - 181 SummonCreature, 1011 SummonSlave (invocation contrôlable), 1008 SummonBomb (bombe Roublard) : monstre
 *    `diceNum` au grade `diceSide`, sur la case ciblée (qui doit être libre) ou, pour une zone étendue (rayon > 1,
 *    formes `;` et `T`), sur les cases libres de la zone triées comme le port (distance au lanceur puis sens horaire),
 *    jusqu'à `value` invocations (0 ⇒ 1) ;
 *  - 180 / 1189 double du lanceur (avec / sans emplacement), 1097 illusions (Roublardise) ;
 *  - 405 / 2796 tue la cible et la remplace par l'invocation ;
 *  - 780 résurrection du dernier allié mort (#1–#2 % de ses PV max érodés, état Zombi), 1034 (idem, en invocation),
 *    147 (idem, `value` %).
 *
 * Limites : les invocations dont le monstre a `useSummonSlot` (et qui jouent) coûtent `summonCost` points (≥ 1,
 * refonte Osamodas 3.1) sur la caractéristique Invocations du lanceur (personnages seulement : les monstres n'en ont
 * pas dans les données) ; les bombes (`useBombSlot`) sont limitées à
 * `tags.maxBombs` (défaut 3, INCERTAIN) ; statiques, tourelles, arbres… sont illimités ; `bypassSummoningLimit` du sort
 * lève la limite. Une invocation joue juste après son invocateur (Engine.spawn), lance son sort de départ à
 * l'apparition, déclenche `CI` sur l'invocateur et produit l'événement de replay `summon` ; son apparition (comme une
 * résurrection) déclenche les marques de sa case comme une arrivée forcée (port `HandleSummon` → `ExecuteMarks`).
 * Effet différé : la case ciblée est celle du lancer d'origine (`ctx.originCell`) et la zone est recalculée.
 */
import type { EffectData, MonsterData, SpellLevelData } from '../../data/model'
import type { GameDataStore } from '../../data/store'
import { cellInDirection, distance, lookDirection4, lookDirection8, ORTHOGONAL_DIRECTIONS } from '../../map/geometry'
import { zoneCells } from '../../map/zones'
import { snapshot, type Engine } from '../engine'
import { createMonsterFighter } from '../factory'
import { roll } from '../random'
import { casterPassesMask, matchesTargetMask } from '../targetMask'
import type { Fighter, FightState } from '../types'
import { castSubSpell, markAppearing, usedSummonSlots, type TriggerEvent } from './core'
import { relocate } from './movement/common'
import { registerEffect, type EffectContext } from './registry'

/** Nombre de bombes simultanées par défaut (caractéristique `maxBomb` non modélisée) — INCERTAIN pour Dofus 3. */
export const DEFAULT_MAX_BOMBS = 3
/** État Zombi posé sur un ressuscité (port `ExecuteZombi`). */
export const ZOMBI_STATE = 74
/**
 * Bombe lancée sur une case occupée (1008 sur une entité) : le lanceur exécute le sort « sur entité » de la bombe
 * (port `GetBombCastOnFighterSpell` ; correspondance déduite des données, docs/research/classes/roublard.md §3.1).
 */
export const BOMB_CAST_ON_FIGHTER: Readonly<Record<number, number>> = { 3112: 13456, 3113: 13459, 3114: 13463, 5161: 13503 }

/**
 * Résurrection en zone étendue (780 de Vortexiphan, zone C63,3) : ressusciter TOUS les alliés morts éligibles (guides
 * du Vortex, vortex.md §6) plutôt que le seul dernier (description de l'effet). INCERTAIN — option globale.
 */
export const summonOptions = { reviveAllInArea: true }

// ───────────────────────────── utilitaires ─────────────────────────────

/** Coût en points d'invocation d'un monstre (0 = hors limite : statique, bombe, tourelle...). */
export function summonSlotCost(m: MonsterData): number {
  if (!m.useSummonSlot || m.canPlay === false) return 0
  return Math.max(1, m.summonCost ?? 1)
}

/** Points d'invocation encore disponibles pour `f` (caractéristique Invocations − invocations vivantes). */
export function availableSummonSlots(fight: FightState, f: Fighter): number {
  return f.stats.summons - usedSummonSlots(fight, f)
}

/** Bombes vivantes de `f`. */
export function bombCount(fight: FightState, f: Fighter): number {
  let n = 0
  for (const o of fight.fighters) if (o.alive && o.summonerId === f.id && o.tags.bombSlot === true) n++
  return n
}

/**
 * Ordre des cases du port (`TargetManagement.ComparePositions`, sens normal) : distance croissante à `ref`, puis
 * direction (E, SE, S… à partir du NE : sens horaire), puis id.
 */
export function comparePositions(ref: number, a: number, b: number): number {
  const da = distance(a, ref)
  const db = distance(b, ref)
  if (da !== db) return da - db
  if (a === b) return 0
  const dirA = lookDirection8(ref, a)
  const dirB = lookDirection8(ref, b)
  if (dirA === dirB) {
    if (dirA === 0 || dirA >= 5) return a < b ? -1 : 1
    return a < b ? 1 : -1
  }
  return ((dirA + 1) & 7) - ((dirB + 1) & 7)
}

/** Zone « étendue » pour une invocation (port : rayon > 1, ou formes `;` et `T`). */
function isAreaSummon(ctx: EffectContext): boolean {
  const z = ctx.effect.zone
  return z.size > 1 || z.shape === ';' || z.shape === 'T'
}

function isFreeWalkable(engine: Engine, fight: FightState, cell: number): boolean {
  return cell >= 0 && engine.isCellFree(fight, cell)
}

/** Case ciblée par le lancer (pour un effet différé : celle du lancer d'origine, `originCell`). */
function castCell(ctx: EffectContext): number {
  return ctx.originCell ?? ctx.targetCell
}

/**
 * Cases candidates d'une invocation en zone, dans l'ordre du port (depuis la case du lanceur). Les cases pré-calculées
 * par le noyau ne valent que pour un effet lancé directement : un effet différé ou déclenché ne reçoit que la case du
 * porteur (`cells = [porteur]`), la zone est alors recalculée autour de la case ciblée (du lancer d'origine).
 */
function areaCells(ctx: EffectContext): number[] {
  const ref = ctx.caster.cell >= 0 ? ctx.caster.cell : ctx.casterCell
  const direct = ctx.originCell === undefined && ctx.cells.length > 1
  const cells = direct ? ctx.cells.slice() : zoneCells(ctx.effect.zone, castCell(ctx), ctx.casterCell)
  return cells.sort((a, b) => comparePositions(ref, a, b))
}

function triggerOpts(ctx: EffectContext): { trigger?: TriggerEvent } | undefined {
  return ctx.trigger ? { trigger: ctx.trigger as TriggerEvent } : undefined
}

// ───────────────────────────── création ─────────────────────────────

export interface SummonOptions {
  /** Flag critique hérité (sort de départ). */
  crit?: boolean
  /** Profondeur de récursion courante (sous-sorts). */
  depth?: number
  /** Invocation contrôlable (1011, 2796) : tag `controllable`. */
  controllable?: boolean
  /** Ne pas lancer le sort de départ. */
  noStartingSpell?: boolean
}

/**
 * Lance le sort de départ d'un monstre (`grades[].startingSpellId`, id de spell-level) sur sa propre case.
 * À appeler aussi par les scénarios pour les monstres présents au début du combat (Vortex 5006, vagues 5002).
 */
export function castStartingSpell(engine: Engine, fight: FightState, f: Fighter, opts: { crit?: boolean; depth?: number } = {}): boolean {
  if (f.monsterId === undefined || !f.alive || f.cell < 0) return false
  const m = engine.data.monster(f.monsterId)
  const g = m?.grades.find(x => x.grade === f.grade) ?? m?.grades[m.grades.length - 1]
  if (!g) return false
  let lvl: SpellLevelData | undefined
  const byId = (engine.data as Partial<GameDataStore>).spellLevelById
  if (g.startingSpellLevelId && byId) lvl = byId.call(engine.data, g.startingSpellLevelId)
  if (!lvl && g.startingSpell) lvl = engine.data.spellLevel(g.startingSpell.spellId, { grade: g.startingSpell.grade })
  if (!lvl) return false
  return castSubSpell(engine, fight, f, lvl.spellId, lvl.grade, f.cell, opts.crit ?? false, opts.depth ?? 0, { level: lvl })
}

/**
 * Ajoute un combattant invoqué au combat : timeline (juste après l'invocateur), événement `summon`, entité
 * « apparue » (masques U), marques de sa case, déclencheur `CI` (« le porteur invoque ») de l'invocateur, puis sort
 * de départ — ordre du port : `HandleSummon` (→ `ExecuteMarks`), `TriggerHandler`, puis `GetStartingSpell`.
 */
export function addSummon(engine: Engine, fight: FightState, summoner: Fighter, f: Fighter, opts: SummonOptions = {}): Fighter {
  if (f.hp <= 0) f.hp = f.maxHp = f.baseMaxHp = 1
  if (summoner.cell >= 0 && f.cell >= 0 && summoner.cell !== f.cell) f.direction = lookDirection4(summoner.cell, f.cell)
  engine.spawn(fight, f)
  engine.emit(fight, { t: 'summon', summoner: summoner.id, fighter: snapshot(f) })
  markAppearing(f)
  enterArrivalCell(engine, fight, f)
  if (!fight.ended && summoner.alive) engine.trigger(fight, summoner, { type: 'CI', source: summoner })
  if (!opts.noStartingSpell && !fight.ended) castStartingSpell(engine, fight, f, { crit: opts.crit, depth: opts.depth })
  return f
}

const FROM_DRAG = { fromDrag: true }

/**
 * Apparition (invocation, résurrection) ou téléportation sur une case : marques de la case (pièges, glyphes-auras),
 * comme une arrivée forcée (port `HandleSummon` → `ExecuteMarks(fromDrag: true)` : pas de glyphe immédiate).
 */
function enterArrivalCell(engine: Engine, fight: FightState, f: Fighter): void {
  if (fight.ended || !f.alive || f.cell < 0) return
  if (fight.traps.length === 0 && fight.glyphs.length === 0) return
  engine.hooks.onEnterCell?.(fight, f, f.cell, FROM_DRAG)
}

/** Invoque le monstre `monsterId` (grade `grade`) pour `summoner` sur `cell` (supposée libre). */
export function summonMonster(
  engine: Engine,
  fight: FightState,
  summoner: Fighter,
  monsterId: number,
  grade: number,
  cell: number,
  opts: SummonOptions = {},
): Fighter | undefined {
  const m = engine.data.monster(monsterId)
  if (!m) return undefined
  const f = createMonsterFighter(engine.data, { monsterId, grade, team: summoner.team, cell, summonerId: summoner.id, summoner })
  f.tags.summonCost = summonSlotCost(m)
  if (m.useBombSlot) f.tags.bombSlot = true
  if (opts.controllable) f.tags.controllable = true
  return addSummon(engine, fight, summoner, f, opts)
}

/** Copie d'un combattant (double 180/1189, illusion 1097) : mêmes caractéristiques, sans sorts. */
export function createDoubleFighter(caster: Fighter, cell: number, opts: { illusion?: boolean; slot?: boolean } = {}): Fighter {
  // Caractéristiques permanentes de l'original (ses buffs ne sont pas copiés) — INCERTAIN.
  const stats = { ...caster.baseStats }
  const hp = opts.illusion ? 1 : Math.max(1, caster.hp)
  const maxHp = opts.illusion ? 1 : Math.max(hp, caster.maxHp)
  return {
    id: -1,
    team: caster.team,
    kind: 'summon',
    name: `${opts.illusion ? 'Illusion' : 'Double'} de ${caster.name}`,
    breedId: caster.breedId,
    level: caster.level,
    baseStats: stats,
    stats: { ...stats },
    hp,
    maxHp,
    baseMaxHp: maxHp,
    shield: 0,
    ap: stats.ap,
    mp: stats.mp,
    cell,
    alive: true,
    states: [],
    buffs: [],
    spells: [],
    cooldowns: {},
    castsThisTurn: {},
    castsOnTarget: {},
    summonerId: caster.id,
    ai: opts.illusion ? 'static' : 'double',
    direction: caster.direction,
    tags: opts.illusion
      ? { illusion: true, canPlay: false, summonCost: 0 }
      : { double: true, summonCost: opts.slot === false ? 0 : 1, controllable: true },
  }
}

// ───────────────────────────── handlers ─────────────────────────────

/** 181 / 1011 / 1008 : invocation d'un monstre (case ciblée libre, ou cases libres d'une zone étendue). */
function summonHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const m = engine.data.monster(effect.diceNum)
  if (!m) return
  const cell = castCell(ctx)
  const mc = fight.map.cells[cell]
  if (!mc || !mc.walkable) return
  const isBomb = effect.effectId === 1008 || m.useBombSlot === true
  const cost = summonSlotCost(m)
  const bypass = engine.data.spell(ctx.spellId)?.bypassSummoningLimit === true
  // Limite des personnages seulement : les monstres n'ont pas de caractéristique Invocations dans les données (INCERTAIN).
  let slots = cost > 0 && !bypass && caster.kind === 'player' ? availableSummonSlots(fight, caster) : Infinity
  let bombs = isBomb ? ((caster.tags.maxBombs as number | undefined) ?? DEFAULT_MAX_BOMBS) - bombCount(fight, caster) : Infinity
  const opts: SummonOptions = { crit: ctx.crit, depth: ctx.depth, controllable: effect.effectId === 1011 }
  if (!isAreaSummon(ctx)) {
    const occupant = engine.fighterAt(fight, cell)
    if (occupant) {
      // Bombe lancée sur une entité : sort « sur entité » de la bombe (explosion directe).
      const sub = effect.effectId === 1008 ? BOMB_CAST_ON_FIGHTER[effect.diceNum] : undefined
      if (sub) castSubSpell(engine, fight, caster, sub, effect.diceSide, cell, ctx.crit, ctx.depth, triggerOpts(ctx))
      return
    }
    if (slots < cost || bombs <= 0) return
    summonMonster(engine, fight, caster, m.id, effect.diceSide, cell, opts)
    return
  }
  let remaining = effect.value > 0 ? effect.value : 1
  for (const c of areaCells(ctx)) {
    if (remaining <= 0 || slots < cost || bombs <= 0 || fight.ended || !caster.alive) break
    if (!isFreeWalkable(engine, fight, c)) continue
    if (!summonMonster(engine, fight, caster, m.id, effect.diceSide, c, opts)) continue
    remaining--
    slots -= cost
    if (isBomb) bombs--
  }
}

/** 180 / 1189 : double du lanceur (pas pour une invocation, port `Summon`). */
function doubleHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (caster.summonerId !== undefined) return
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const cell = castCell(ctx)
  if (!isFreeWalkable(engine, fight, cell)) return
  const slot = effect.effectId === 180
  if (slot && caster.kind === 'player' && availableSummonSlots(fight, caster) < 1) return
  addSummon(engine, fight, caster, createDoubleFighter(caster, cell, { slot }), { crit: ctx.crit, depth: ctx.depth, noStartingSpell: true })
}

/**
 * 1097 : `diceNum` illusions du lanceur sur les cases à la même distance que la cible dans les 4 axes du lanceur
 * (port), le lanceur prenant la place de celle de la case ciblée (Roublardise). Illusions : 1 PV, ne jouent pas.
 */
function illusionsHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (caster.summonerId !== undefined || caster.cell < 0) return
  const target = castCell(ctx)
  if (engine.fighterAt(fight, target)) return
  const d = distance(caster.cell, target)
  if (d <= 0) return
  const candidates: number[] = []
  for (const dir of ORTHOGONAL_DIRECTIONS) {
    const c = cellInDirection(caster.cell, dir, d)
    if (c >= 0) candidates.push(c)
  }
  candidates.sort((a, b) => comparePositions(caster.cell, a, b))
  let count = Math.max(1, effect.diceNum)
  let moveTo = -1
  for (const c of candidates) {
    if (!isFreeWalkable(engine, fight, c)) continue
    if (c === target) {
      moveTo = c
      continue
    }
    if (count <= 0) break
    addSummon(engine, fight, caster, createDoubleFighter(caster, c, { illusion: true }), { noStartingSpell: true })
    count--
  }
  if (moveTo >= 0 && caster.alive) {
    // Téléportation (historique de position tenu par movement/common) : arrivée forcée pour les marques.
    relocate(engine, fight, caster, moveTo)
    enterArrivalCell(engine, fight, caster)
  }
}

/** 405 / 2796 : tue chaque cible et invoque `diceNum` à sa place (si la limite le permet, la cible libérant sa place). */
function killAndSummonHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  const m = engine.data.monster(effect.diceNum)
  if (!m) return
  const cost = summonSlotCost(m)
  for (const t of ctx.targets) {
    if (fight.ended || !caster.alive) break
    if (!t.alive || t.cell < 0) continue
    const freed = t.summonerId === caster.id ? ((t.tags.summonCost as number | undefined) ?? 0) : 0
    if (cost > 0 && caster.kind === 'player' && usedSummonSlots(fight, caster) - freed + cost > caster.stats.summons) continue
    const cell = t.cell
    engine.kill(fight, t, caster)
    if (fight.ended || !caster.alive || !isFreeWalkable(engine, fight, cell)) continue
    summonMonster(engine, fight, caster, m.id, effect.diceSide, cell, { crit: ctx.crit, depth: ctx.depth, controllable: effect.effectId === 2796 })
  }
}

// ───────────────────────────── résurrection ─────────────────────────────

/** Le masque restreint-il le type d'allié ressuscité (h, l, d, m, i, j, s) ? Sinon : tout allié (port). */
const TYPED_ALLY_MASK = /(^|,)[hldmijs](,|$)/

/** Alliés morts ressuscitables par `caster`, du plus récent au plus ancien (avec leur case de mort). */
function deadAllies(ctx: EffectContext): { f: Fighter; cell: number }[] {
  const { fight, caster, effect } = ctx
  const out: { f: Fighter; cell: number }[] = []
  const deaths = fight.deaths
  if (!deaths) return out
  const typed = !!effect.targetMask && TYPED_ALLY_MASK.test(effect.targetMask)
  for (let i = deaths.length - 1; i >= 0; i--) {
    const d = deaths[i]
    const f = fight.fighters[d.fighter]
    if (!f || f.alive || f.cell >= 0 || f.team !== caster.team || f.id === caster.id) continue
    if (out.some(o => o.f === f)) continue
    if (typed && !matchesTargetMask(effect.targetMask, caster, f)) continue
    out.push({ f, cell: d.cell })
  }
  return out
}

/**
 * Ressuscite `f` sur `cell` avec `pct` % de ses PV max (érodés conservés) : état Zombi, retour dans la timeline
 * (après le lanceur s'il en avait été retiré), entité « apparue », événement `summon` pour le replay, `CI`.
 */
export function reviveFighter(engine: Engine, fight: FightState, caster: Fighter, f: Fighter, cell: number, pct: number): void {
  f.alive = true
  f.cell = cell
  f.shield = 0
  f.hp = Math.max(1, Math.min(f.maxHp, Math.floor((f.maxHp * pct) / 100)))
  f.carriedBy = undefined
  f.carrying = undefined
  if (!fight.timeline.includes(f.id)) {
    const at = fight.timeline.indexOf(caster.id)
    const idx = at >= 0 ? at + 1 : fight.timeline.length
    fight.timeline.splice(idx, 0, f.id)
    if (idx <= fight.turnIndex) fight.turnIndex++
  }
  for (const b of f.buffs.slice()) if (b.stateId === ZOMBI_STATE) engine.removeBuff(fight, f, b.uid)
  engine.recomputeStats(f)
  f.ap = Math.max(0, f.stats.ap)
  f.mp = Math.max(0, f.stats.mp)
  engine.emit(fight, { t: 'summon', summoner: caster.id, fighter: snapshot(f) })
  engine.addBuff(fight, f, {
    sourceId: caster.id,
    spellId: 0,
    effect: ZOMBI_EFFECT,
    value: ZOMBI_STATE,
    remaining: -1,
    delay: 0,
    dispellable: false,
    stateId: ZOMBI_STATE,
    kind: 'stat',
    label: 'Zombi',
  })
  markAppearing(f)
  if (!fight.ended && caster.alive) engine.trigger(fight, caster, { type: 'CI', source: caster })
  enterArrivalCell(engine, fight, f)
}

const ZOMBI_EFFECT: EffectData = {
  effectId: 950,
  order: 0,
  diceNum: 0,
  diceSide: 0,
  value: ZOMBI_STATE,
  duration: -1,
  delay: 0,
  random: 0,
  group: 0,
  targetMask: 'a,A',
  targetId: 0,
  triggers: 'I',
  dispellable: 4,
  element: -1,
  zone: { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
}

/**
 * 780 / 1034 : invoque le dernier allié mort avec #1–#2 % de ses PV. Case : celle de sa mort si libre, sinon la case
 * ciblée (port) ; en zone étendue (Vortexiphan C63,3), les cases libres de la zone dans l'ordre du port (≥ rayon min,
 * distance croissante, sens horaire) et, avec `summonOptions.reviveAllInArea`, tous les alliés éligibles.
 * 1034 sur un monstre : nouvelle invocation du même monstre/grade sur la case ciblée, le cadavre étant consommé (port
 * `CharacterSummonDeadAllyAsSummonInFight`, `RemoveDeadFighter`).
 */
function reviveHandler(ctx: EffectContext): void {
  const { engine, fight, caster, effect } = ctx
  if (effect.targetMask && !casterPassesMask(effect.targetMask, caster)) return
  const candidates = deadAllies(ctx)
  if (!candidates.length) return
  const area = isAreaSummon(ctx)
  const free = area ? areaCells(ctx).filter(c => isFreeWalkable(engine, fight, c)) : []
  const count = area && summonOptions.reviveAllInArea ? candidates.length : 1
  // 147 « Ressuscite un allié avec #3 % de sa vie » : pourcentage dans `value`.
  const lo = effect.effectId === 147 ? effect.value : effect.diceNum
  const hi = effect.effectId === 147 ? effect.value : effect.diceSide > 0 ? effect.diceSide : effect.diceNum
  const target = castCell(ctx)
  for (let i = 0; i < count && i < candidates.length; i++) {
    if (fight.ended) break
    const { f, cell: deathCell } = candidates[i]
    // 1034 sur un monstre : nouvelle invocation (port : `SummonMonster` placé sur la case ciblée, le mort reste mort).
    const asNewSummon = effect.effectId === 1034 && f.monsterId !== undefined && f.kind !== 'player'
    let cell = -1
    if (area) {
      while (free.length && !isFreeWalkable(engine, fight, free[0])) free.shift()
      cell = free.shift() ?? -1
    } else if (asNewSummon) {
      if (isFreeWalkable(engine, fight, target)) cell = target
    } else if (isFreeWalkable(engine, fight, deathCell)) cell = deathCell
    else if (isFreeWalkable(engine, fight, target)) cell = target
    if (cell < 0) break
    const pct = roll(fight, lo, hi)
    if (asNewSummon) {
      // Le cadavre est « consommé » (port `RemoveDeadFighter`) : il ne peut pas être ré-invoqué une seconde fois.
      if (fight.deaths) fight.deaths = fight.deaths.filter(d => d.fighter !== f.id)
      const s = summonMonster(engine, fight, caster, f.monsterId!, f.grade ?? 1, cell, { crit: ctx.crit, depth: ctx.depth })
      if (s) s.hp = Math.max(1, Math.min(s.maxHp, Math.floor((s.maxHp * pct) / 100)))
      continue
    }
    if (effect.effectId === 1034) f.summonerId = caster.id
    reviveFighter(engine, fight, caster, f, cell, pct)
  }
}

/**
 * Enregistre un interprète de la famille. Les effets `forClientOnly` (« info-bulle uniquement » : ligne affichée d'un
 * sort dont l'effet réel est porté par un sous-sort ou exécuté côté serveur) sont ignorés, comme dans les familles
 * dégâts, déplacements et buffs : les appliquer doublerait l'effet réel (ex. aura 1091 et invocation 181 de
 * *Barricade*, rune 2022 de *Lance-flamme* — la vraie est posée par le sous-sort 13687 —, portails 1181 de *Stupeur*).
 */
function register(ids: number | number[], handler: (ctx: EffectContext) => void, perTarget: boolean): void {
  registerEffect(
    ids,
    'summons',
    ctx => {
      if (!ctx.effect.clientOnly) handler(ctx)
    },
    perTarget,
  )
}

register([181, 1011, 1008], summonHandler, false)
register([180, 1189], doubleHandler, false)
// 1024 « Crée des illusions » (4 sorts de monstres) : traité comme 1097 — INCERTAIN.
register([1097, 1024], illusionsHandler, false)
register([405, 2796], killAndSummonHandler, true)
register([780, 1034, 147], reviveHandler, false)
