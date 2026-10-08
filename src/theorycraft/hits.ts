/**
 * Theorycraft contre un boss — coups AU CONTACT ou À DISTANCE et table DPT du theorycraft (docs/design/theorycraft.md
 * §1.5).
 *
 * Règle du jeu (docs/research/formulas.md §3.5, `isMeleeHit`) : un coup est de mêlée dès que la cible est sur une case
 * ADJACENTE au lanceur (distance 1), quelle que soit la portée du sort. Le sac à dos de l'IA du Vortex
 * (src/ai/core/dpt.ts, `isMeleeSpell`) range au contraire chaque sort d'après sa portée max (mêlée ⇔ portée ≤ 1) : un
 * sort de PO 1 à 8 y est toujours « à distance » — il vaudrait 0 contre une phase vulnérable seulement en mêlée (Père
 * Ver) et subirait le « −50 % à distance » de Merkator. Ce module, réservé au theorycraft (l'IA du Vortex garde sa
 * règle) :
 *  - `possibleHits(profil, keep?)` : coups possibles d'un sort sur un ennemi (fonction partagée avec le calculateur
 *    `degats` de la CLI, qui restreint `keep` aux lignes touchant sa cible) — mêlée si PO min ≤ 1 ≤ PO max ou si une
 *    ligne centrée sur le lanceur touche une case adjacente ; distance si PO max ≥ 2 ou si une telle ligne touche une
 *    case à 2 cases ou plus ; aucun ennemi atteignable : règle de l'IA ;
 *  - `TheoryDptTable` (sous-classe du sac à dos, `theoryDptTableOf(moteur)`) :
 *     · PERSONNAGE : un sort lançable au contact ET à distance est évalué dans les deux cas et le coup retenu est celui
 *       que la CIBLE subit le mieux (`meleeResPct`/`rangedResPct`, « dommages subis » mêlée/distance : « −50 % à
 *       distance » de Merkator, phase vulnérable en mêlée seule), comparé sans les % dommages mêlée/distance du lanceur ;
 *       à égalité, le style du personnage (étiquette `CONTACT_TAG` : joué au contact ⇒ mêlée, sinon distance). Les %
 *       dommages du lanceur suivent ce coup ; `hitOf` dit lequel (le proxy de stuff y lit quels % dommages comptent :
 *       une classe de contact valorise ses % mêlée).
 *       Heuristiques du sac à dos inchangées dans `perCast` (poisons × min(durée, 2) × 0,8, différés × 0,8 : `turn`,
 *       proxy de stuff) ; le DPT soutenu (rotation.ts) suit, lui, les poisons actifs à partir de `split` ;
 *     · MONSTRE (dégâts reçus) : conventions de la fiche du boss (bossProfile.ts) pour que le tour reçu du proxy et le
 *       pic de la fiche parlent des mêmes dégâts — mêlée ⇔ portée ≤ 1, poisons comptés une fois par tour de durée (au
 *       plus `SUSTAINED_TURNS`, `periodicTicks`), effets différés comptés au lancer (× 1) ;
 *     · `castLines` : lignes retenues d'un lancer (placement et coup de `perCast`) et leur poids — forme fermée du
 *       proxy de stuff.
 *
 * Module PUR : aucun import `node:`, ni de src/dungeons, ni du proxy de stuff.
 */
import { castDamage, casterZoneCover, DptTableImpl, isMeleeSpell, lineDamage, lineHpDependent, spellCritPct, type CastDamage } from '../ai/core/dpt'
import { damageDigest } from '../ai/core/hash'
import { zoneHitsCenter, zoneRadius, type DamageLineX, type SpellProfileX } from '../ai/core/spellProfile'
import type { Stats } from '../core/types'
import type { EffectData, SpellLevelData } from '../data/model'
import { effectSpellRef } from '../data/refs'
import type { DataStore } from '../data/store'
import type { Engine } from '../engine'
import { CAST_SPELL_EFFECTS } from '../engine/effects/core'
import { matchesTargetMask } from '../engine/targetMask'
import type { Fighter } from '../engine/types'
import { distance, pointToCell } from '../map/geometry'
import { zoneCells } from '../map/zones'
import { periodicTicks } from './bossProfile'

// ---------------------------------------------------------------------------------------------------------------------
// Coups possibles d'un sort
// ---------------------------------------------------------------------------------------------------------------------

/** Case centrale de la carte (x 17, y −3) : lanceur fictif pour mesurer les zones centrées sur lui. */
const PROBE_CELL = pointToCell(17, -3)

const HITS = new WeakMap<SpellProfileX, { melee: boolean; range: boolean }>()

/**
 * Coups possibles d'un sort sur un ennemi (voir l'en-tête). Cible sur la case d'impact : distance = PO min..max ;
 * lignes centrées sur le lanceur (portée 0, sous-sorts « autour du lanceur ») : distances des cases de leur zone
 * (`zoneCells`). Aucun ennemi atteignable : heuristique de l'IA (`isMeleeSpell`, portée ≤ 1).
 *
 * `keep` : lignes centrées sur le lanceur prises en compte (défaut : celles qui touchent un ennemi, résultat mis en
 * cache par profil ; le calculateur `degats` de la CLI : celles qui touchent SA cible, masques de cible compris — non
 * mis en cache). Même règle du jeu dans les deux cas.
 */
export function possibleHits(prof: SpellProfileX, keep?: (l: DamageLineX) => boolean): { melee: boolean; range: boolean } {
  if (keep) return computeHits(prof, keep)
  let r = HITS.get(prof)
  if (!r) HITS.set(prof, (r = computeHits(prof, l => l.sides.enemy)))
  return r
}

function computeHits(prof: SpellProfileX, keep: (l: DamageLineX) => boolean): { melee: boolean; range: boolean } {
  let melee = prof.minRange <= 1 && prof.maxRange >= 1
  let range = prof.maxRange >= 2
  for (const l of prof.damage) {
    if (!keep(l) || !(l.aroundCaster || prof.maxRange === 0)) continue
    for (const cell of zoneCells(l.zone, PROBE_CELL, PROBE_CELL)) {
      const d = distance(PROBE_CELL, cell)
      if (d === 1) melee = true
      else if (d >= 2) range = true
    }
  }
  if (!melee && !range) return isMeleeSpell(prof) ? { melee: true, range: false } : { melee: false, range: true }
  return { melee, range }
}

// ---------------------------------------------------------------------------------------------------------------------
// Table DPT du theorycraft
// ---------------------------------------------------------------------------------------------------------------------

/** Échéance d'un poison posé par un lancer (DPT soutenu). */
export interface DotTick {
  /** Ligne de dégâts (identité : un même poison, cumulé ou rafraîchi). */
  line: DamageLineX
  /** Dégâts d'une échéance (SANS critique, comme le moteur et la fiche ; probabilité de la ligne comprise). */
  tick: number
  /** Échéances par application (tours de durée). */
  turns: number
  /** Instances cumulables sur la cible (`maxStack` du niveau qui porte l'effet ; ∞ si illimité). */
  stack: number
}

/** Lancer décomposé : part immédiate (différés × 0,8 compris) et poisons. */
export interface CastSplit {
  immediate: number
  dots: DotTick[]
}

/** Ligne retenue d'un lancer et son poids (probabilité × poison / différé selon le lanceur). */
export interface WeightedLine {
  line: DamageLineX
  weight: number
}

interface Entry {
  cast: CastDamage
  /** Coup retenu : mêlée ? */
  melee: boolean
  /** Profil évalué (personnage : celui du sort ; monstre : lignes re-pondérées selon la fiche). */
  prof: SpellProfileX
  split?: CastSplit
}

const ZERO: CastDamage = Object.freeze({ mean: 0, variance: 0 }) as CastDamage

/**
 * Étiquette d'un personnage joué au contact (`Fighter.tags`) : à égalité de la cible, un sort lançable au contact et à
 * distance compte en mêlée (sinon à distance). Posée par `playerFighterFromStats` (`TheoryCharacter.contact`) et par le
 * proxy de stuff (`ProxyOptions.contact`).
 */
export const CONTACT_TAG = 'theoryContact'
const ENTRY_MAX = 40000

/** Copie de `a` aux caractéristiques augmentées des gains `preBoost` du profil (comme `castDamage`). */
function boostedAttacker(a: Fighter, p: SpellProfileX): Fighter {
  if (!p.preBoost.length) return a
  const st = { ...a.stats } as unknown as Record<string, number>
  for (const x of p.preBoost) st[x.stat] = (st[x.stat] ?? 0) + x.value
  return { ...a, stats: st as unknown as Stats }
}

/** Heuristique du sac à dos pour une ligne de personnage (src/ai/core/dpt.ts, `castDamage`). */
function heuristicWeight(line: DamageLineX): number {
  let w = line.p
  if (line.dotTurns > 0) w *= Math.min(line.dotTurns, 2) * 0.8
  else if (line.delayed > 0) w *= 0.8
  return w
}

/**
 * Profil d'un sort de MONSTRE aux conventions de la fiche du boss : poisons × échéances (`periodicTicks`, ≤ 6),
 * différés × 1 — lignes recopiées avec ce poids dans `p` (même profil si rien ne change).
 */
const MONSTER_PROFILES = new WeakMap<SpellProfileX, SpellProfileX>()
function monsterProfile(p: SpellProfileX): SpellProfileX {
  let r = MONSTER_PROFILES.get(p)
  if (r) return r
  let changed = false
  const damage = p.damage.map(l => {
    if (l.dotTurns > 0) {
      changed = true
      return { ...l, dotTurns: 0, delayed: 0, p: l.p * periodicTicks(l.effect) }
    }
    if (l.delayed > 0) {
      changed = true
      return { ...l, delayed: 0 }
    }
    return l
  })
  r = changed ? { ...p, damage } : p
  MONSTER_PROFILES.set(p, r)
  return r
}

const HP_DEP = new WeakMap<SpellProfileX, boolean>()
function hpDependentProfile(p: SpellProfileX): boolean {
  let v = HP_DEP.get(p)
  if (v === undefined) HP_DEP.set(p, (v = p.damage.some(lineHpDependent)))
  return v
}

/** Niveau de sort (racine ou sous-sort lancé par le lanceur, profondeur ≤ 4) qui contient l'effet. */
function levelOfEffect(data: DataStore, level: SpellLevelData, e: EffectData, depth = 0, seen = new Set<SpellLevelData>()): SpellLevelData | undefined {
  if (seen.has(level)) return undefined
  seen.add(level)
  const has = (x: EffectData) => x === e || (e.uid !== undefined && x.uid === e.uid)
  if (level.effects.some(has) || level.criticalEffects.some(has)) return level
  if (depth >= 4) return undefined
  for (const x of [...level.effects, ...level.criticalEffects]) {
    if (!CAST_SPELL_EFFECTS.has(x.effectId)) continue
    const ref = effectSpellRef(x)
    const sub = ref && data.spellLevel(ref.spellId, { grade: ref.grade })
    const found = sub && levelOfEffect(data, sub, e, depth + 1, seen)
    if (found) return found
  }
  return undefined
}

/**
 * Instances cumulables d'un poison (moteur, buffs/common.ts `enforceMaxStack`) : `maxStack` du niveau de sort qui porte
 * l'effet (≤ 0 : illimité) ; 1 si ce niveau retire d'abord ses propres effets (406 sur son sort).
 */
const STACKS = new WeakMap<DamageLineX, number>()
function dotStack(data: DataStore, p: SpellProfileX, line: DamageLineX): number {
  let s = STACKS.get(line)
  if (s !== undefined) return s
  const lvl = levelOfEffect(data, p.level, line.effect) ?? p.level
  s = lvl.maxStack > 0 ? lvl.maxStack : Infinity
  const at = lvl.effects.indexOf(line.effect)
  if (lvl.effects.some((x, k) => x.effectId === 406 && x.value === lvl.spellId && (at < 0 || k < at))) s = 1
  STACKS.set(line, s)
  return s
}

/**
 * Sac à dos du theorycraft (voir l'en-tête) : `perCast` réécrit (coup au contact ou à distance pour un personnage,
 * conventions de la fiche pour un monstre), même `turn` que l'IA. Caches propres, indexés par style du personnage et
 * empreintes « dégâts » ; les sorts « % PV » (dépendant des PV) ne sont jamais mis en cache.
 */
export class TheoryDptTable extends DptTableImpl {
  /** Caches par style (index 1 : joué au contact) → empreinte du lanceur → empreinte de la cible → un lancer par sort. */
  private readonly entries = [new Map<number, Map<number, (Entry | undefined)[]>>(), new Map<number, Map<number, (Entry | undefined)[]>>()]
  private entryCount = 0

  override perCast(a: Fighter, spellIndex: number, d: Fighter): CastDamage {
    return this.entry(a, spellIndex, d)?.cast ?? ZERO
  }

  /** Coup retenu pour le i-ème sort de `a` contre `d` : mêlée (vrai) ou distance. */
  hitOf(a: Fighter, spellIndex: number, d: Fighter): boolean {
    const e = this.entry(a, spellIndex, d)
    if (e) return e.melee
    const p = this.profiles.ofFighter(a)[spellIndex]
    return p ? isMeleeSpell(p) : false
  }

  /**
   * Lignes retenues d'un lancer (placement — centre ou couronne — et coup de `perCast`) avec leur poids : personnage,
   * heuristiques du sac à dos ; monstre, conventions de la fiche. Σ poids × `lineDamage` = `perCast(…).mean`.
   */
  castLines(a: Fighter, spellIndex: number, d: Fighter): { melee: boolean; lines: WeightedLine[] } {
    const e = this.entry(a, spellIndex, d)
    if (!e) return { melee: false, lines: [] }
    const prof = e.prof
    const ring = (e.cast.ringMean ?? 0) > (e.cast.centerMean ?? 0)
    const ab = boostedAttacker(a, prof)
    const lines: WeightedLine[] = []
    for (const line of prof.damage) {
      let center: boolean
      let inRing: boolean
      if (line.aroundCaster) {
        if (!casterZoneCover(line.zone)) continue
        center = false
        inRing = true
      } else {
        center = !prof.needFreeCell && zoneHitsCenter(line.zone)
        inRing = zoneRadius(line.zone) > 0
      }
      if (!(ring ? inRing : center)) continue
      if (!matchesTargetMask(line.mask, ab, d)) continue
      if (line.gates && !line.gates.every(g => matchesTargetMask(g, ab, d))) continue
      lines.push({ line, weight: heuristicWeight(line) })
    }
    return { melee: e.melee, lines }
  }

  /**
   * Lancer d'un personnage décomposé (DPT soutenu) : part immédiate (lignes directes, différés × 0,8 comme le sac à
   * dos) et échéances des poisons, sans l'heuristique « × min(durée, 2) × 0,8 » et SANS critique (le moteur ne fait
   * pas critiquer les échéances : Flèche Tyrannique du Crâ, 362 par échéance contre 435 critique pondéré). Si la
   * décomposition ne redonne pas `perCast` (cas imprévu), lancer entier en part immédiate (heuristique gardée).
   */
  split(a: Fighter, spellIndex: number, d: Fighter): CastSplit {
    const e = this.entry(a, spellIndex, d)
    if (!e) return { immediate: 0, dots: [] }
    if (e.split) return e.split
    const p = e.prof
    const ab = boostedAttacker(a, p)
    const crit = spellCritPct(ab, p)
    const isWeapon = a.spells[spellIndex].isWeapon === true
    let immediate = 0
    let heuristic = 0
    const dots: DotTick[] = []
    for (const { line, weight } of this.castLines(a, spellIndex, d).lines) {
      const v = lineDamage(ab, d, line, p.spellId, isWeapon, e.melee, 1, crit).mean
      heuristic += weight * v
      if (line.dotTurns > 0) {
        const tick = line.p * lineDamage(ab, d, line, p.spellId, isWeapon, e.melee, 1, 0).mean
        dots.push({ line, tick, turns: line.dotTurns, stack: dotStack(this.engine.data, p, line) })
      } else immediate += weight * v
    }
    const ok = Math.abs(heuristic - e.cast.mean) <= 1e-6 * Math.max(1, Math.abs(e.cast.mean))
    const split = ok ? { immediate, dots } : { immediate: e.cast.mean, dots: [] }
    if (!hpDependentProfile(p)) e.split = split
    return split
  }

  override clear(): void {
    super.clear()
    for (const m of this.entries) m.clear()
    this.entryCount = 0
  }

  private entry(a: Fighter, spellIndex: number, d: Fighter): Entry | undefined {
    const p = this.profiles.ofFighter(a)[spellIndex]
    if (!p || !p.damage.length) return undefined
    if (hpDependentProfile(p)) return this.compute(a, spellIndex, d, p)
    const cache = this.entries[a.tags[CONTACT_TAG] === true ? 1 : 0]
    const ak = damageDigest(a)
    let byD = cache.get(ak)
    if (!byD) cache.set(ak, (byD = new Map()))
    const dk = damageDigest(d)
    let row = byD.get(dk)
    if (!row) {
      if (this.entryCount >= ENTRY_MAX) {
        for (const m of this.entries) m.clear()
        this.entryCount = 0
        cache.set(ak, (byD = new Map()))
      }
      byD.set(dk, (row = new Array(a.spells.length)))
      this.entryCount++
    }
    return (row[spellIndex] ??= this.compute(a, spellIndex, d, p))
  }

  private compute(a: Fighter, spellIndex: number, d: Fighter, p: SpellProfileX): Entry {
    const isWeapon = a.spells[spellIndex].isWeapon === true
    if (a.kind !== 'player') {
      const prof = monsterProfile(p)
      const melee = isMeleeSpell(p)
      return { cast: castDamage(a, d, prof, isWeapon, 1, melee), melee, prof }
    }
    const hits = possibleHits(p)
    let melee = hits.melee
    if (hits.melee && hits.range) {
      // Coup choisi par la cible : lanceur sans % dommages mêlée/distance ; à égalité, style du personnage.
      const neutral: Fighter = { ...a, stats: { ...a.stats, meleeDamagePct: 0, rangedDamagePct: 0 } }
      const m = castDamage(neutral, d, p, isWeapon, 1, true).mean
      const r = castDamage(neutral, d, p, isWeapon, 1, false).mean
      melee = m > r + 1e-9 ? true : r > m + 1e-9 ? false : a.tags[CONTACT_TAG] === true
    }
    return { cast: castDamage(a, d, p, isWeapon, 1, melee), melee, prof: p }
  }
}

const TABLES = new WeakMap<Engine, TheoryDptTable>()

/** Table DPT du theorycraft d'un moteur (partagée ; distincte de celle de l'IA, `createDptTable`). */
export function theoryDptTableOf(engine: Engine): TheoryDptTable {
  let t = TABLES.get(engine)
  if (!t) TABLES.set(engine, (t = new TheoryDptTable(engine)))
  return t
}
