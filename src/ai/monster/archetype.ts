/**
 * Archétypes de monstres inférés des sorts (docs/design/ai.md §11.6, docs/research/monster-ai.md §3, §5) — WP1.
 *
 * Les données ne donnent pas le comportement d'un monstre : on l'infère de ses sorts (profils analytiques du socle,
 * `SpellProfileX`, fermeture des sous-sorts comprise) et de ses drapeaux DofusDB, première règle vraie :
 *
 *  | Archétype  | Détection                                                                  | Comportement de déplacement |
 *  |------------|----------------------------------------------------------------------------|-----------------------------|
 *  | static     | `canPlay = false`, ou 0 PA et 0 PM (Auroraire)                            | static                      |
 *  | apathetic  | aucun sort (et des PM), ou aucun effet sur un ennemi ni sur un allié      | apathetic                   |
 *  | summoner   | une ligne d'invocation (181, 180, 1189, 780, 405, 1008…)                  | kiter si sort à distance, sinon fearful / aggressive |
 *  | healer     | soin (108, 1109, 2998-3002…) au masque allié, hors vol de vie et 786      | support                     |
 *  | blocker    | aucun sort de dégâts, peut tacler, tacle ≥ 40                              | blocker                     |
 *  | fearful    | tous les sorts offensifs ont portée min ≥ 2 et portée max ≥ 5             | fearful                     |
 *  | kiter      | un sort de dégâts de portée max > 3 (min < max) et aucun sort de corps-à-corps | kiter                   |
 *  | aggressive | tout le reste                                                              | aggressive                  |
 *
 * Capacités (poids seulement) : `summon`, `heal`, `buff` (buff d'allié), `kamikaze` (141 « tue » sur le lanceur ou
 * déclencheur de mort X), `invisible` (150). Les tags DofusDB (« heal », « summon »… calculés par DofusDB, non
 * exhaustifs et parfois trompeurs : « heal » couvre le vol de vie) ne servent que de signal secondaire : `summon` et
 * `poison` confirment une capacité, jamais seuls. Cache par (moteur, monstre, grade).
 */
import type { Engine } from '../../engine/engine'
import type { Fighter } from '../../engine/types'
import { castGeom, levelFor } from '../core/castCells'
import { createSpellProfileIndex, type SpellProfileX } from '../core/spellProfile'
import type { Archetype, Behaviour, Capability } from './types'

export interface ArchetypeInfo {
  archetype: Archetype
  behaviour: Behaviour
  capabilities: Record<Capability, boolean>
  /** Anneau de portée de ses sorts de dégâts (kiter) : [min, max]. */
  preferredRange?: [number, number]
  /** Portée maximale de ses sorts de dégâts (−1 : aucun). */
  maxDamageRange: number
  /** Un sort de dégâts de corps-à-corps (portée max ≤ 1, ou zone autour de soi). */
  melee: boolean
}

const CACHE = new WeakMap<Engine, Map<string, ArchetypeInfo>>()

/** Effets « tue la cible » (141) et invisibilité (150). */
const KILL_EFFECT = 141
const INVISIBILITY_EFFECT = 150

function hasDamage(p: SpellProfileX): boolean {
  return p.damage.some(d => d.sides.enemy)
}

/** Le sort a un effet sur un ennemi (dégâts, retrait, état, déplacement, débuff). */
function affectsEnemies(p: SpellProfileX): boolean {
  return p.hitsEnemies || hasDamage(p) || p.removals.some(r => r.sides.enemy) || p.states.some(s => s.sides.enemy)
    || p.moves.some(m => m.sides.enemy) || p.enemyDebuff
}

/** Le sort a un effet utile pour un allié ou pour soi. */
function affectsAllies(p: SpellProfileX): boolean {
  return p.selfBuff || p.allyBuff || p.heals.length > 0 || p.shields.length > 0 || p.summonLines.length > 0 || p.glyph || p.trap
}

/** Clé de cache d'un combattant : monstre et grade (sinon nom et sorts, pour les doubles et invocations de classe). */
function keyOf(f: Fighter): string {
  if (f.monsterId !== undefined) return `m${f.monsterId}:${f.grade ?? 0}`
  return `x${f.breedId ?? 0}:${f.spells.map(s => s.spellId).join(',')}`
}

/** Archétype, comportement et capacités inférés d'un monstre (voir l'en-tête). */
export function inferArchetype(engine: Engine, f: Fighter): ArchetypeInfo {
  let byEngine = CACHE.get(engine)
  if (!byEngine) CACHE.set(engine, (byEngine = new Map()))
  const key = keyOf(f)
  const hit = byEngine.get(key)
  if (hit) return hit
  const info = compute(engine, f)
  byEngine.set(key, info)
  return info
}

function compute(engine: Engine, f: Fighter): ArchetypeInfo {
  const profiles = createSpellProfileIndex(engine).ofFighter(f)
  const md = f.monsterId !== undefined ? engine.data.monster(f.monsterId) : undefined
  const tags = new Set(md?.tags ?? [])
  const caps: Record<Capability, boolean> = { summon: false, heal: false, buff: false, kamikaze: false, invisible: false }
  let minRange = 99
  let maxRange = -1
  let melee = false
  let anyDamage = false
  let allRangedFar = true
  let anyEnemyEffect = false
  let anyAllyEffect = false
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i]
    const lvl = levelFor(f, f.spells[i])
    if (affectsEnemies(p)) anyEnemyEffect = true
    if (affectsAllies(p)) anyAllyEffect = true
    if (p.summonLines.length) caps.summon = true
    if (p.heals.some(h => h.sides.ally && !h.sides.selfOnly)) caps.heal = true
    if (p.allyBuff || p.shields.some(s => s.sides.ally && !s.sides.selfOnly)) caps.buff = true
    for (const e of lvl.effects) {
      if (e.effectId === KILL_EFFECT && /(^|,)[cC](,|$)/.test(e.targetMask)) caps.kamikaze = true
      if (e.effectId === INVISIBILITY_EFFECT) caps.invisible = true
      if (e.triggers && /(^|\|)X(\||$)/.test(e.triggers)) caps.kamikaze = caps.kamikaze || p.selfCast
    }
    if (!hasDamage(p)) continue
    anyDamage = true
    const g = castGeom(f, lvl)
    // Sort de portée 0 à zone (Cercle de feu) : corps-à-corps de fait.
    const reachMax = g.max === 0 ? Math.max(1, p.zoneRadius) : g.max
    const reachMin = g.max === 0 ? 1 : Math.max(1, g.min)
    if (reachMax <= 1) melee = true
    if (reachMin < minRange) minRange = reachMin
    if (reachMax > maxRange) maxRange = reachMax
    if (reachMin < 2 || reachMax < 5) allRangedFar = false
  }
  if (tags.has('summon')) caps.summon = caps.summon || profiles.some(p => p.summons.length > 0)
  const isStatic = f.tags.canPlay === false || f.tags.static === true || (f.baseStats.ap <= 0 && f.baseStats.mp <= 0)
  const ranged = anyDamage && maxRange > 3 && minRange < maxRange
  const pref: [number, number] | undefined = anyDamage ? [Math.max(1, minRange), Math.max(1, maxRange)] : undefined
  const out = (archetype: Archetype, behaviour: Behaviour): ArchetypeInfo => ({
    archetype, behaviour, capabilities: caps, preferredRange: pref, maxDamageRange: maxRange, melee,
  })
  if (isStatic) return out('static', 'static')
  if (!profiles.length || (!anyEnemyEffect && !anyAllyEffect)) return out('apathetic', 'apathetic')
  if (caps.summon) return out('summoner', ranged && !melee ? 'kiter' : anyDamage ? 'aggressive' : 'fearful')
  if (caps.heal) return out('healer', 'support')
  if (!anyDamage && md?.canTackle !== false && f.baseStats.tackleBlock >= 40) return out('blocker', 'blocker')
  if (anyDamage && allRangedFar) return out('fearful', 'fearful')
  if (ranged && !melee) return out('kiter', 'kiter')
  return out('aggressive', 'aggressive')
}

/**
 * Comportement imposé par l'effet 2188 (`fighter.tags.aiBehaviour`, src/engine/effects/buffs/states.ts) ou posé par une
 * IA/un scénario (chaîne). Énumération serveur INCERTAINE (monster-ai.md §1.1) : 1 agressif, 2 paniqué (peureux),
 * 3 « perturbé » (fou, INCERTAIN), 4 dévoué (INCERTAIN), 5 apathique.
 */
export function behaviourFromTag(v: unknown): Behaviour | undefined {
  if (typeof v === 'string') {
    return (['aggressive', 'fearful', 'kiter', 'devoted', 'blocker', 'mad', 'apathetic', 'support', 'static'] as const).find(b => b === v)
  }
  if (typeof v === 'number') {
    switch (v) {
      case 1: return 'aggressive'
      case 2: return 'fearful'
      case 3: return 'mad'
      case 4: return 'devoted'
      case 5: return 'apathetic'
    }
  }
  return undefined
}
