/**
 * Génération des candidats d'un nœud et sélection pour simulation (docs/design/ai.md §8.1) — WP2.
 *
 * Trois sources fusionnées :
 *  1. génériques (src/ai/core/candidates.ts, C1-C8, priors `quick`) ;
 *  2. prix et intentions : indices `kill` du scénario et intentions du combattant (control, burst, protect, cleanse)
 *     ⇒ meilleurs candidats qui touchent la cible, marqués OBLIGATOIRES ; un candidat d'exploration
 *     (`analyticCoverage < 0,7`, en tourniquet) ;
 *  3. tactiques (src/ai/tactics, §10) : séquences de 1 à 4 macro-actions, quota `round(prior·relevance)`, plafond
 *     θ.tactics.maxPerNode par nœud, hors quotas génériques.
 *
 * Sélection : top-K par prior sous QUOTAS par groupe de catégories (standard K = 12 : damage 5, control 2,
 * placement 2, heal/buff 1, summon/mark 1, utility 1, mis à l'échelle de K par plus forts restes), modulés par le rôle
 * (mpLock/apLock : control +2 ; placer : placement +2 ; healer : heal +1 si un allié < 70 %) ; quotas inutilisés
 * redistribués par valeur ; + obligatoires (≤ `mandatoryMax`) ; + propositions des tactiques (sans re-simuler un coup
 * déjà retenu).
 * Ablation `offensiveOnly` : seuls les candidats `damage` (ni tactiques ni obligatoires non offensifs).
 */
import type { Fighter } from '../../engine/types'
import { proposeTactics } from '../tactics'
import type { CandidateCat, MacroAction, TurnBudget } from '../types'
import { genericCands, hitsTarget, profileOf } from './cands'
import { intentActive } from './evaluate'
import type { SearchNode, TacticalContext } from './node'

/** Groupes de quotas (§8.1 : heal/buff et summon/mark partagent un quota). */
const GROUPS: readonly (readonly CandidateCat[])[] = [['damage'], ['control'], ['placement'], ['heal', 'buff'], ['summon', 'mark'], ['utility']]

export interface Generated {
  generic: MacroAction[]
  mandatory: MacroAction[]
  /** Candidat d'exploration : simulé hors quota mais NON obligatoire (soumis au gain minimal). */
  explore: MacroAction[]
  tactics: MacroAction[]
}

/** Quotas par groupe pour K candidats (plus forts restes), modulés par le rôle. */
export function groupQuotas(ctx: TacticalContext, b: TurnBudget, me: Fighter): number[] {
  const base = GROUPS.map(g => Math.max(...g.map(c => b.quotas[c] ?? 0)))
  const total = base.reduce((a, x) => a + x, 0) || 1
  const K = Math.max(1, b.topK)
  const raw = base.map(q => (q * K) / total)
  const out = raw.map(Math.floor)
  let left = K - out.reduce((a, x) => a + x, 0)
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, c) => c.r - a.r || a.i - c.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  const role = ctx.role
  const bonus = K >= 10 ? 2 : 1
  if (role === 'mpLock' || role === 'apLock') out[1] += bonus
  if (role === 'placer') out[2] += bonus
  if (role === 'healer') {
    const s = ctx.root ?? ctx.view.fight
    if (s.fighters.some(f => f.alive && f.team === me.team && f.hp < 0.7 * f.maxHp)) out[3] += 1
  }
  return out
}

function groupOf(cat: CandidateCat): number {
  for (let i = 0; i < GROUPS.length; i++) if (GROUPS[i].includes(cat)) return i
  return GROUPS.length - 1
}

const byPrior = (a: MacroAction, b: MacroAction): number => b.prior - a.prior || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** Candidats du nœud (trois sources). */
export function generate(ctx: TacticalContext, node: SearchNode): Generated {
  const s = node.s
  const me = s.fighters[ctx.view.me.id]
  const out: Generated = { generic: [], mandatory: [], explore: [], tactics: [] }
  if (!me || !me.alive || s.ended || me.ap <= 0) return out
  const generic = genericCands(ctx, node)
  out.generic = ctx.offensiveOnly ? generic.filter(m => m.cat === 'damage') : generic
  if (!out.generic.length && !generic.length) return out
  // Indices « kill » du scénario et intentions du combattant : meilleurs candidats qui touchent la cible.
  const wanted: { target: number; cats?: CandidateCat[]; n: number }[] = []
  for (const h of ctx.hints ?? []) if (h.kind === 'kill' && h.targetId !== undefined && h.weight > 0) wanted.push({ target: h.targetId, n: 2 })
  const root = ctx.root ?? ctx.view.fight
  for (const it of ctx.bb.intents) {
    if (it.owner !== me.id || it.target === undefined || it.price <= 0 || !intentActive(it, root)) continue
    if (it.kind === 'control') wanted.push({ target: it.target, cats: ['control'], n: 1 })
    else if (it.kind === 'burst') wanted.push({ target: it.target, cats: ['damage'], n: 1 })
    else if (it.kind === 'protect' || it.kind === 'cleanse') wanted.push({ target: it.target, cats: ['heal', 'buff', 'placement'], n: 1 })
  }
  const taken = new Set<string>()
  for (const w of wanted) {
    const t = s.fighters[w.target]
    if (!t || !t.alive) continue
    const pool = out.generic.filter(m => (!w.cats || w.cats.includes(m.cat)) && hitsTarget(ctx, s, me, m, w.target)).sort(byPrior)
    for (const m of pool.slice(0, w.n)) {
      if (taken.has(m.key)) continue
      taken.add(m.key)
      out.mandatory.push({ ...m, mandatory: true })
    }
  }
  // Exploration : sort à faible couverture analytique, en tourniquet sur la profondeur.
  if (!ctx.offensiveOnly && !ctx.nested) {
    const explore = generic.filter(m => {
      if (!m.cast || taken.has(m.key)) return false
      const p = profileOf(ctx, me, m.cast.spellId)
      return !!p && p.prof.analyticCoverage < 0.7 && !p.prof.unsupported
    }).sort(byPrior)
    if (explore.length) out.explore.push(explore[node.depth % explore.length])
  }
  if (!ctx.offensiveOnly) out.tactics = proposeTactics(ctx, node)
  return out
}

/**
 * Contenu d'une macro-action (fin de chemin, lancer, séquence), indépendant de sa clé : une tactique qui ré-étiquette
 * un candidat générique (`ml[…]`, `hc[…]`, `gz[…]`, `bs[…]`) propose le MÊME coup ; le simuler deux fois gaspillait
 * des nœuds (≈ 2-3 par profondeur en `fast`) pour un état identique (écarté ensuite par les transpositions).
 */
export function macroContent(m: MacroAction): string {
  const end = m.path && m.path.length > 1 ? m.path[m.path.length - 1] : -1
  const head = `${end}/${m.cast ? `${m.cast.spellId}@${m.cast.cell}` : '-'}`
  return m.seq && m.seq.length ? `${head}{${m.seq.map(macroContent).join(';')}}` : head
}

/** Sélection pour simulation (§8.1) : quotas + obligatoires + tactiques, sans doublon de clé ni de contenu. */
export function selectForSim(ctx: TacticalContext, node: SearchNode, g: Generated, b: TurnBudget): MacroAction[] {
  const me = node.s.fighters[ctx.view.me.id]
  if (!me) return []
  const quotas = groupQuotas(ctx, b, me)
  const byGroup: MacroAction[][] = GROUPS.map(() => [])
  for (const m of g.generic) byGroup[groupOf(m.cat)].push(m)
  for (const list of byGroup) list.sort(byPrior)
  const picked: MacroAction[] = []
  const keys = new Set<string>()
  const add = (m: MacroAction): void => {
    if (keys.has(m.key)) return
    keys.add(m.key)
    picked.push(m)
  }
  for (let gi = 0; gi < GROUPS.length; gi++) for (const m of byGroup[gi].slice(0, quotas[gi])) add(m)
  // Quotas inutilisés redistribués par valeur.
  const K = quotas.reduce((a, x) => a + x, 0)
  if (picked.length < K) {
    const rest = g.generic.filter(m => !keys.has(m.key)).sort(byPrior)
    for (const m of rest) {
      if (picked.length >= K) break
      add(m)
    }
  }
  let mand = 0
  for (const m of g.mandatory) {
    if (mand >= b.mandatoryMax) break
    if (keys.has(m.key)) {
      // Déjà sélectionné : il devient obligatoire (le plan qui le contient n'est pas soumis au gain minimal).
      const i = picked.findIndex(x => x.key === m.key)
      if (i >= 0) picked[i] = { ...picked[i], mandatory: true }
      mand++
      continue
    }
    add(m)
    mand++
  }
  for (const m of g.explore) add(m)
  // Propositions des tactiques : un coup déjà retenu (même contenu) n'est pas re-simulé ; s'il est obligatoire côté
  // tactique (levier d'horloge), l'exemplaire retenu le devient.
  const content = new Map<string, number>()
  picked.forEach((m, i) => content.set(macroContent(m), i))
  for (const m of g.tactics) {
    const c = macroContent(m)
    const i = content.get(c)
    if (i !== undefined) {
      if (m.mandatory && !picked[i].mandatory) picked[i] = { ...picked[i], mandatory: true }
      continue
    }
    const before = picked.length
    add(m)
    if (picked.length > before) content.set(c, picked.length - 1)
  }
  return picked
}
