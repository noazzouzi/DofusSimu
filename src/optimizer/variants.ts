/**
 * Variantes de sorts (niveau L4, docs/design/ai.md §15.5) — WP4b.
 *
 * Départ : variantes du membre (table « choix de variantes par rôle » du preset, data/ai/presets.json). Bascules
 * candidates (une paire de sorts = un choix 0/1 parmi les 22 paires de la classe) :
 *  1. `unused` : paire dont le sort actif n'a jamais été lancé en `usageSeeds` (64) combats (`FightSummary.spellUse`) ;
 *  2. `doctrine` : paire où le membre diffère de son preset de rôle, ou d'un autre preset de sa classe ;
 *  3. (`requires` des tactiques, WP2 : non disponible tant que les tactiques ne sont pas livrées.)
 * Seules les paires dont les DEUX sorts sont supportés par le moteur (`isSpellSupported`, E5) et débloqués au niveau du
 * personnage sont essayées. Évaluation APPARIÉE (graines communes, 16-32) contre la configuration courante ;
 * acceptation gloutonne si le gain est significatif (Δ objectif > 0 et z ≥ `minZ`), au plus `maxToggles` (6)
 * bascules par personnage. Le résultat ne peut donc jamais être moins bon que le départ sur les graines d'évaluation.
 */
import type { GameDataStore } from '../data/store'
import { isSpellSupported } from '../engine/effects/support'
import type { FightCache } from './cache'
import type { FightExecutor } from './montecarlo'
import { campaignSeeds } from './seeds'
import { proxyEngine } from './stuff/proxy'
import { findPreset, presetsOf } from './team/presets'
import { evaluateSpec, pairedVectors, type ConfigEval, type Objective, type PairedObjective } from './tune'
import type { FightSpec, MemberSpec, WorkerTask } from './types'

export type ToggleReason = 'unused' | 'doctrine'

export interface VariantToggle {
  member: number
  pair: number
  from: 0 | 1
  to: 0 | 1
  spellFrom: number
  spellTo: number
  reason: ToggleReason
}

export interface VariantSearchOptions {
  /** Graines de l'évaluation appariée (défaut 24). */
  seeds?: number
  masterSeed?: number
  /** Combats servant à mesurer l'usage des sorts (défaut 64 ; 0 = pas de bascules « unused »). */
  usageSeeds?: number
  /** Bascules acceptées au plus par personnage (défaut 6). */
  maxToggles?: number
  /** Bascules essayées au plus par personnage (défaut 8). */
  maxCandidates?: number
  /** Seuil de significativité (défaut 2). */
  minZ?: number
  /** Membres concernés (défaut : tous). */
  members?: readonly number[]
  kind?: WorkerTask['kind']
  cache?: FightCache
  objective?: Objective
}

export interface VariantTrial {
  toggle: VariantToggle
  paired: PairedObjective
  accepted: boolean
}

export interface VariantSearchResult {
  /** Équipe finale (variantes mises à jour). */
  team: MemberSpec[]
  accepted: VariantToggle[]
  trials: VariantTrial[]
  base: ConfigEval
  final: ConfigEval
  /** Combats joués (hors cache). */
  fights: number
}

/** Variantes d'un membre (membre, sinon build, sinon preset). */
export function memberVariants(m: MemberSpec): (0 | 1)[] {
  if (m.variants.length) return m.variants.slice()
  if (m.build.spellVariants?.length) return m.build.spellVariants.slice()
  return findPreset(m.presetId)?.variants.slice() ?? []
}

/** Membre avec une paire basculée (membre et build mis à jour). */
export function applyToggle(m: MemberSpec, pair: number, to: 0 | 1): MemberSpec {
  const v = memberVariants(m)
  while (v.length < 22) v.push(0)
  v[pair] = to
  return { ...m, variants: v, build: { ...m.build, spellVariants: v.slice() } }
}

/** Les deux sorts d'une paire sont-ils débloqués et supportés par le moteur ? */
export function pairSupported(data: GameDataStore, breedId: number, pair: number, level: number): boolean {
  const breed = data.breed(breedId)
  const ids = breed?.spellPairs[pair]
  if (!ids) return false
  const engine = proxyEngine(data)
  return ids.every((id, k) => {
    const need = breed?.spellPairUnlockLevels?.[pair]?.[k]
    if (need !== undefined && need > level) return false
    const lvl = data.spellLevel(id, { playerLevel: level })
    return !!lvl && isSpellSupported(engine, lvl)
  })
}

/** Bascules candidates d'un membre (voir l'en-tête), ordre : inutilisées puis doctrine, puis indice de paire. */
export function candidateToggles(data: GameDataStore, team: readonly MemberSpec[], memberIdx: number, spellUse?: Readonly<Record<number, number>>): VariantToggle[] {
  const m = team[memberIdx]
  const breed = data.breed(m.breedId)
  if (!breed) return []
  const v = memberVariants(m)
  const level = m.build.level
  const out: VariantToggle[] = []
  const add = (pair: number, reason: ToggleReason) => {
    if (out.some(t => t.pair === pair)) return
    const from = (v[pair] ?? 0) as 0 | 1
    const to = (1 - from) as 0 | 1
    if (!pairSupported(data, m.breedId, pair, level)) return
    const ids = breed.spellPairs[pair]
    out.push({ member: memberIdx, pair, from, to, spellFrom: ids[from], spellTo: ids[to], reason })
  }
  if (spellUse) {
    breed.spellPairs.forEach((ids, pair) => {
      const active = ids[v[pair] ?? 0]
      if (!(spellUse[active] > 0)) add(pair, 'unused')
    })
  }
  const doctrine = [findPreset(m.presetId), ...presetsOf(m.breedId)].filter((p): p is NonNullable<typeof p> => !!p)
  for (const p of doctrine) p.variants.forEach((x, pair) => (x !== (v[pair] ?? 0) ? add(pair, 'doctrine') : undefined))
  return out
}

/** Somme des lancers par sort d'un lot. */
export function spellUsage(e: ConfigEval): Record<number, number> {
  const out: Record<number, number> = {}
  for (const s of e.summaries) for (const [k, n] of Object.entries(s.spellUse)) out[Number(k)] = (out[Number(k)] ?? 0) + n
  return out
}

/** Recherche gloutonne des variantes (voir l'en-tête). */
export async function optimizeVariants(data: GameDataStore, base: FightSpec, pool: FightExecutor, opts: VariantSearchOptions = {}): Promise<VariantSearchResult> {
  const seeds = campaignSeeds(opts.masterSeed ?? 0x7a12, opts.seeds ?? 24)
  const evalOpts = { kind: opts.kind, cache: opts.cache, objective: opts.objective }
  let fights = 0
  let team = base.team.map(m => ({ ...m, variants: memberVariants(m) }))
  let current = await evaluateSpec({ ...base, team }, seeds, pool, evalOpts)
  fights += seeds.length
  const baseEval = current
  let usage: Record<number, number> | undefined
  if ((opts.usageSeeds ?? 64) > 0) {
    const useSeeds = campaignSeeds((opts.masterSeed ?? 0x7a12) ^ 0x5e11, opts.usageSeeds ?? 64)
    usage = spellUsage(await evaluateSpec({ ...base, team }, useSeeds, pool, evalOpts))
    fights += useSeeds.length
  }
  const accepted: VariantToggle[] = []
  const trials: VariantTrial[] = []
  const members = opts.members ?? team.map((_, i) => i)
  for (const mi of members) {
    const cands = candidateToggles(data, team, mi, usage).slice(0, opts.maxCandidates ?? 8)
    let n = 0
    for (const t of cands) {
      if (n >= (opts.maxToggles ?? 6)) break
      const trialTeam = team.map((m, i) => (i === mi ? applyToggle(m, t.pair, t.to) : m))
      const e = await evaluateSpec({ ...base, team: trialTeam }, seeds, pool, evalOpts)
      fights += seeds.length
      const paired = pairedVectors(current.perSeed, e.perSeed)
      const ok = paired.diff > 0 && paired.z >= (opts.minZ ?? 2)
      trials.push({ toggle: t, paired, accepted: ok })
      if (ok) {
        team = trialTeam
        current = e
        accepted.push(t)
        n++
      }
    }
  }
  return { team, accepted, trials, base: baseEval, final: current, fights }
}
