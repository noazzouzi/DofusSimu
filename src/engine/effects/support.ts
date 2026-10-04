/**
 * (E5, docs/design/ai.md §3.3, §6.3) Couverture d'un sort par le moteur : un sort est « supporté » si chaque effet de
 * sa fermeture (effets normaux ET critiques, sous-sorts lancés par 792/793/1017-1019/1160/2160/… et sorts des marques
 * posées par 400/401/402/4040/1165/1091/2022, jusqu'à `MAX_DEPTH`) a un interprète enregistré (`registeredEffects()`).
 *
 * Les effets purement visuels (`clientOnly`) sont ignorés (ils ne changent pas l'état). Un sous-sort introuvable dans
 * les données rend le sort non supporté (l'effet ne serait pas simulé). L'IA n'utilise pas un sort non supporté
 * (`AIConfig.unsupportedSpells = 'skip'`) ; l'optimiseur exclut les passifs non supportés.
 *
 * Résultat mis en cache par niveau de sort (objet partagé du DataStore), invalidé si le registre grandit.
 */
import type { EffectData, SpellLevelData } from '../../data/model'
import type { Engine } from '../engine'
import { CAST_SPELL_EFFECTS, MAX_DEPTH } from './core'
import { registeredEffects } from './registry'

/** Effets de pose de marque dont `diceNum`/`diceSide` désignent le sort joué par la marque (effects/marks.ts). */
export const MARK_SPELL_EFFECTS: ReadonlySet<number> = new Set([400, 401, 402, 4040, 1165, 1091, 2022])

export interface SpellSupport {
  supported: boolean
  /** effectId sans interprète rencontrés dans la fermeture (triés, sans doublon). */
  missingEffects: number[]
  /** Sous-sorts référencés mais absents des données (`spellId:grade`). */
  missingSpells: string[]
  /** Nombre de niveaux de sorts visités (sort racine compris). */
  visited: number
}

const cache = new WeakMap<SpellLevelData, { registrySize: number; result: SpellSupport }>()

/** Analyse la fermeture d'un niveau de sort (voir l'en-tête). */
export function spellSupport(engine: Engine, level: SpellLevelData): SpellSupport {
  const registry = registeredEffects()
  const hit = cache.get(level)
  if (hit && hit.registrySize === registry.size) return hit.result
  const missingEffects = new Set<number>()
  const missingSpells = new Set<string>()
  const seen = new Set<SpellLevelData>()
  const visit = (lvl: SpellLevelData, depth: number): void => {
    if (seen.has(lvl) || depth > MAX_DEPTH) return
    seen.add(lvl)
    const scan = (effects: readonly EffectData[]) => {
      for (const e of effects) {
        if (e.clientOnly) continue
        if (!registry.has(e.effectId)) missingEffects.add(e.effectId)
        if ((CAST_SPELL_EFFECTS.has(e.effectId) || MARK_SPELL_EFFECTS.has(e.effectId)) && e.diceNum > 0) {
          const sub = engine.data.spellLevel(e.diceNum, { grade: e.diceSide || undefined })
          if (sub) visit(sub, depth + 1)
          else missingSpells.add(`${e.diceNum}:${e.diceSide}`)
        }
      }
    }
    scan(lvl.effects)
    scan(lvl.criticalEffects)
  }
  visit(level, 0)
  const result: SpellSupport = {
    supported: missingEffects.size === 0 && missingSpells.size === 0,
    missingEffects: [...missingEffects].sort((a, b) => a - b),
    missingSpells: [...missingSpells].sort(),
    visited: seen.size,
  }
  cache.set(level, { registrySize: registry.size, result })
  return result
}

/** Vrai si toute la fermeture du sort est simulée par le moteur (E5). */
export function isSpellSupported(engine: Engine, level: SpellLevelData): boolean {
  return spellSupport(engine, level).supported
}
