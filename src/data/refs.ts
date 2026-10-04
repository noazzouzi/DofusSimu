/**
 * Effets qui référencent d'autres données : sorts lancés / glyphes / pièges, invocations, états, niveaux de sort.
 * Listes recopiées de `data/dofusdb/manifest.json.spellRefEffects` (déterminées empiriquement par
 * scripts/fetch-dofusdb.mjs, cf. dofusdb-api.md §2.6) ; un test vérifie qu'elles restent synchronisées.
 *
 * Utilisé pour la fermeture des lots de données (memory.ts) et utilisable par le moteur (sorts déclenchés,
 * marques, invocations).
 */
import type { EffectData, ItemEffectRange } from './model'

/** `diceNum` = id de sort (lancers, marques, modificateurs, sorts passifs d'objets 1175…). */
export const SPELL_REF_DICENUM_EFFECTS: ReadonlySet<number> = new Set([
  237, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 314, 400, 401,
  402, 792, 793, 798, 799, 814, 1017, 1018, 1019, 1035, 1036, 1045, 1084, 1091, 1160, 1161, 1165, 1175, 1187, 2017, 2018,
  2022, 2160, 2792, 2793, 2794, 2795, 2880, 2905, 2906, 2908, 2909, 2910, 2911, 2914, 2932, 2933, 2934, 2935, 2960, 3281,
  3282, 3285, 3287, 3289, 3290, 3293, 3296, 3333, 3935, 4040, 4052,
])

/** Modificateurs de sort (« #1 : +#3 Portée »…) : `diceNum` = sort modifié, `value` = valeur, pas de grade. */
export const SPELL_MODIFIER_EFFECTS: ReadonlySet<number> = new Set([
  280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 314, 798, 799, 1035,
  1036, 1045, 2905, 2906, 2908, 2909, 2910, 2911, 2914, 2932, 2933, 2934, 2935, 3281, 3282, 3285, 3287, 3289, 3290, 3293,
  3296, 3333, 3935, 4052,
])

/** Effet 2018 « dissipe les glyphes d'un sort » : `diceNum` = sort, sans grade. */
const SPELL_REF_DICENUM_NO_GRADE: ReadonlySet<number> = new Set([2018])

/** `value` = id de sort (406 enlève les effets d'un sort, 722/2997 sort temporaire, 1026, 1406). */
export const SPELL_REF_VALUE_EFFECTS: ReadonlySet<number> = new Set([406, 722, 1026, 1406, 2997])

/** Parmi SPELL_REF_VALUE_EFFECTS, ceux dont `diceSide` est un grade / rang. */
const SPELL_REF_VALUE_WITH_GRADE: ReadonlySet<number> = new Set([722, 1406, 2997])

/** `diceSide` = id de spell-level (1181 : portail Eliotrope). */
export const SPELL_LEVEL_REF_DICESIDE_EFFECTS: ReadonlySet<number> = new Set([1181])

/** Invocations : `diceNum` = monstre, `diceSide` = grade. */
export const SUMMON_EFFECTS: ReadonlySet<number> = new Set([181, 405, 1008, 1011, 2796])

/** États : `value` = id d'état (950 ajoute, 951 enlève, 952 désactive). */
export const STATE_EFFECTS: ReadonlySet<number> = new Set([950, 951, 952])

/** Paramètres bruts d'un effet (EffectData ou effet brut). */
interface EffectParams {
  effectId: number
  diceNum: number
  diceSide: number
  value: number
}

export interface SpellRef {
  spellId: number
  /** Grade du sort référencé (absent : non précisé par l'effet — modificateurs, 406, 1026, 2018). */
  grade?: number
}

/** Sort référencé par un effet (hors 1181, cf. effectSpellLevelRef), ou undefined. */
export function effectSpellRef(e: EffectParams): SpellRef | undefined {
  const id = e.effectId
  if (SPELL_REF_DICENUM_EFFECTS.has(id)) {
    if (e.diceNum <= 0) return undefined
    if (SPELL_MODIFIER_EFFECTS.has(id) || SPELL_REF_DICENUM_NO_GRADE.has(id) || e.diceSide <= 0) return { spellId: e.diceNum }
    return { spellId: e.diceNum, grade: e.diceSide }
  }
  if (SPELL_REF_VALUE_EFFECTS.has(id)) {
    if (e.value <= 0) return undefined
    return SPELL_REF_VALUE_WITH_GRADE.has(id) && e.diceSide > 0 ? { spellId: e.value, grade: e.diceSide } : { spellId: e.value }
  }
  return undefined
}

/** Id de spell-level référencé (effet 1181), ou undefined. */
export function effectSpellLevelRef(e: EffectParams): number | undefined {
  return SPELL_LEVEL_REF_DICESIDE_EFFECTS.has(e.effectId) && e.diceSide > 0 ? e.diceSide : undefined
}

/** Monstre invoqué par un effet, ou undefined. */
export function effectSummonRef(e: EffectParams): { monsterId: number; grade: number } | undefined {
  return SUMMON_EFFECTS.has(e.effectId) && e.diceNum > 0 ? { monsterId: e.diceNum, grade: Math.max(1, e.diceSide) } : undefined
}

/** État ajouté / retiré / désactivé par un effet, ou undefined. */
export function effectStateRef(e: EffectParams): number | undefined {
  return STATE_EFFECTS.has(e.effectId) && e.value > 0 ? e.value : undefined
}

/**
 * États cités par un masque de cible (`E#` / `e#`, y compris préfixés `*` = condition sur le lanceur).
 * Ex. `"a,A,*E4254"` -> [4254].
 */
export function targetMaskStates(mask: string): number[] {
  const out: number[] = []
  if (!mask) return out
  for (const token of mask.split(',')) {
    const m = /^\*?[Ee](\d+)$/.exec(token.trim())
    if (m) {
      const s = Number(m[1])
      if (!out.includes(s)) out.push(s)
    }
  }
  return out
}

/**
 * Sort référencé par un effet d'objet / de panoplie (1175 sort passif : `min` = sort, `max` = grade ;
 * 722 / 2997 sort temporaire : `value` = sort). Les modificateurs de sort de classe (281-297…) sont ignorés.
 */
export function itemEffectSpellRef(e: ItemEffectRange): SpellRef | undefined {
  if (SPELL_MODIFIER_EFFECTS.has(e.effectId)) return undefined
  const diceSide = e.max !== e.min ? e.max : 0
  return effectSpellRef({ effectId: e.effectId, diceNum: e.min, diceSide, value: e.value ?? 0 })
}

/** Raccourci : toutes les références d'un effet de sort runtime. */
export function effectRefs(e: EffectData): {
  spell?: SpellRef
  spellLevelId?: number
  summon?: { monsterId: number; grade: number }
  state?: number
  maskStates: number[]
} {
  return {
    spell: effectSpellRef(e),
    spellLevelId: effectSpellLevelRef(e),
    summon: effectSummonRef(e),
    state: effectStateRef(e),
    maskStates: targetMaskStates(e.targetMask),
  }
}
