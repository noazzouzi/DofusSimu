/**
 * Types de scripts/lib/dofusdb-normalize.mjs (normalisation des grades de monstres DofusDB, schémas 3.6 et 3.7),
 * pour les tests TypeScript (le module reste en JavaScript : scripts/fetch-dofusdb.mjs l'importe sous Node sans
 * compilation). Le format produit est celui de src/data/raw.ts (RawMonsterGrade).
 */
import type { RawMonsterBonusCharacteristics, RawMonsterGrade } from '../../src/data/raw'

/** Grade tel que renvoyé par l'API (3.6 ou 3.7) ou déjà normalisé : clés libres. */
export type ApiMonsterGrade = { readonly [key: string]: unknown; bonusCharacteristics?: Readonly<Partial<Record<string, number>>> }

/** Monstre normalisé, vu par le garde-fou (`id`, `name`, `isBoss`, `grades`). */
export interface GuardedMonster {
  id: number
  name?: { fr?: string | null; en?: string | null } | null
  isBoss?: boolean
  grades?: readonly object[]
}

export type ApiGradeSchema = '3.6' | '3.7' | 'inconnu'

export const RESISTANCE_FIELDS: readonly ['neutralResistance', 'earthResistance', 'fireResistance', 'waterResistance', 'airResistance']
export const RENAMED_37: Readonly<Record<string, keyof RawMonsterGrade>>
export const OPTIONAL_GRADE_FIELDS: readonly (keyof RawMonsterGrade)[]
export const IGNORED_GRADE_KEYS: readonly string[]

export function apiGradeSchema(g: ApiMonsterGrade): ApiGradeSchema
export function normBonusCharacteristics(b: Readonly<Partial<Record<string, number>>> | undefined): RawMonsterBonusCharacteristics | undefined
export function normGrade(g: ApiMonsterGrade): RawMonsterGrade
export function unknownGradeKeys(g: ApiMonsterGrade): string[]
export function summarizeGradeSchemas(monsters: readonly { grades?: readonly ApiMonsterGrade[] }[]): {
  gradeSchemas: Partial<Record<ApiGradeSchema, number>>
  unknownKeys: Record<string, number>
}
export function gameVersionInfo(
  gradeSchemas: Partial<Record<ApiGradeSchema, number>>,
  override?: string | boolean,
): { version: string; source: string }
/** Boss témoins exigés par défaut par le garde-fou (Vortex 3835). */
export const SENTINEL_BOSS_IDS: readonly number[]
export function bossResistanceProblems(monsters: readonly GuardedMonster[], options?: { requiredBossIds?: readonly number[] }): string[]
export function assertBossResistances(
  monsters: readonly GuardedMonster[],
  options?: { maxShown?: number; requiredBossIds?: readonly number[] },
): void
