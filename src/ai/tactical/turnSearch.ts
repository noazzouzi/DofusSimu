/**
 * Recherche tactique d'un tour de joueur (docs/design/ai.md §8.2, §8.3) — WP2.
 *
 * Un seul moteur de tour, paramétré par le mode :
 *  - `fast` : faisceau de largeur 1 (topK 6, ≤ 40 nœuds par tour), replanifié après chaque action par l'exécuteur tant
 *    que le reste du budget du tour le permet, et sur écart (team/controller.ts) ;
 *  - `standard` : faisceau 6 (topK 12, profondeur 6, 1 500 nœuds), 3 rollouts d'équipe avec pessimisme β ;
 *  - `deep` : faisceau 12 (topK 20, profondeur 8, 15 000 nœuds), 6 rollouts, MCTS sur les décisions clés (mcts.ts).
 *
 * ```
 * root = clone « vu par l'équipe » ; beam = [root] ; leaves = [root] ; seen = transpositions (hash → meilleure V)
 * pour depth < maxDepth : enfants = ⋃_{n ∈ beam} expand(n, c) pour c ∈ selectForSim(generate(n))
 *     expand : clone salé (même sel pour les frères), macro-action, V non terminale (continuation), split léthal
 *     beam = selectDiverse(enfants, largeur)
 * finals = finalize(topN(leaves, 2·largeur)) (déplacement de fin, V terminale) ; rollouts sur les `rollouts` meilleurs
 * pass = finalize(root) ; plan = argmax(finals) si gain ≥ θ.value.minGain ou candidat obligatoire, sinon « rien »
 * ```
 * `selectDiverse` : tri par valeur, un emplacement réservé au meilleur enfant contenant une action non `damage` si sa
 * valeur ≥ best − θ.tactical.diversityMargin·|best − racine|, refus d'un 3e enfant de même signature structurelle
 * (multiensemble des catégories + 1er sort), complément par valeur. Les plans complets sont comparés entre eux
 * (feuilles terminales) ; avec des rollouts, seuls les plans « déroulés » (et « rien », déroulé lui aussi) sont comparés
 * (le mélange 0,5·V + 0,5·rollout n'est pas comparable à une V seule).
 *
 * Split léthal (`standard`/`deep`, au plus un par chemin, §6.7) : une cible qui finit à 0 < PV ≤ 8 % PVmax ou meurt
 * ⇒ le lancer est rejoué en jets min/max, valeur = p·V(tué) + (1 − p)·V(survivant) ; la correction (`adj`) suit le
 * chemin jusque dans la valeur déroulée. Écart au design : tout kill est testé (le filtre « marge < 8 % » de
 * l'espérance DPT laissait passer les kills qui ne tiennent qu'au coup critique).
 * Sorts à groupes aléatoires (`hasRandomGroups`) : simulés deux fois (deux sels) hors `fast`, valeur moyenne.
 * Rejets durs (C9) : lanceur tué ; tir ami > 20 % des PV d'un allié sans gain ≥ 2× sur les ennemis.
 */
import { mix32 } from '../../core/hash'
import { isStaticFighter } from '../../engine/targetMask'
import type { FightState } from '../../engine/types'
import {
  applyMacro, hpEff, lethalSplit, simClone, simSalt, stateHash, viewOn, type PerceptionX,
} from '../core'
import type { CandidateCat, MacroAction, TacticId, TurnBudget } from '../types'
import { profileOf } from './cands'
import { evalLeaf, hourOf, rootInfo } from './evaluate'
import { finalize } from './finalMove'
import { generate, selectForSim } from './generate'
import type { FinalLeaf, SearchNode, SearchPlan, StepDigest, TacticalContext } from './node'
import { subBudget, teamRollout } from './rollout'

export type { TacticalContext } from './node'

/** Budget « décision clé » (§8.8) : standard ⇒ largeur 10, 6 rollouts (les nœuds sont doublés par l'appelant). */
export function boostBudget(b: TurnBudget): TurnBudget {
  return { ...b, width: Math.max(b.width, 10), rollouts: Math.max(b.rollouts, 6), maxNodes: b.maxNodes * Math.max(1, b.keyDecisionBoost) }
}

/** Sel de la racine d'une recherche (déterministe : tour, créneau, combattant). */
function rootSalt(s: FightState, meId: number): number {
  return mix32(mix32(s.round, s.turnIndex), meId ^ 0x7ac3) >>> 0
}

/** Empreinte prévue après une étape (§8.7). */
export function digestOf(before: FightState, after: FightState, meId: number): StepDigest {
  const me = after.fighters[meId]
  const alive: number[] = []
  const hp: [number, number, number][] = []
  const moved: [number, number, number, number][] = []
  for (const f of after.fighters) {
    if (f.alive) alive.push(f.id)
    const b = before.fighters[f.id]
    if (!b || !b.alive) continue
    const h0 = b.hp + b.shield
    const h1 = f.alive ? f.hp + f.shield : 0
    if (Math.abs(h1 - h0) >= 1) hp.push([f.id, h1, h0])
    if (f.id !== meId && f.alive && (f.cell !== b.cell || Math.abs(f.stats.ap - b.stats.ap) > 0.05 || Math.abs(f.stats.mp - b.stats.mp) > 0.05)) {
      moved.push([f.id, f.cell, f.stats.ap, f.stats.mp])
    }
  }
  return {
    meCell: me ? me.cell : -1,
    meAp: me ? me.ap : 0,
    meMp: me ? me.mp : 0,
    fighters: after.fighters.length,
    alive,
    hp,
    symbol: hourOf(after) || -1,
    ...(moved.length ? { moved } : {}),
  }
}

/** Nœud racine (état assaini, V non terminale). */
function makeRootNode(ctx: TacticalContext): SearchNode {
  if (!ctx.root) ctx.root = simClone(ctx.view, ctx.view.fight, rootSalt(ctx.view.fight, ctx.view.me.id))
  const root = ctx.root
  const info = rootInfo(ctx)
  return {
    s: root,
    hash: stateHash(root),
    depth: 0,
    actions: [],
    v: info.v.total,
    breakdown: info.v,
    adj: 0,
    split: false,
    tactics: [],
    cats: [],
    hasMandatory: false,
    digests: [],
  }
}

/** Dégâts / pertes subis par les alliés et infligés aux ennemis entre deux états (rejet C9). */
function friendlyFire(before: FightState, after: FightState, team: number): { worstPct: number; friendly: number; enemy: number } {
  let worstPct = 0
  let friendly = 0
  let enemy = 0
  for (const f of after.fighters) {
    const b = before.fighters[f.id]
    if (!b || !b.alive) continue
    const lost = hpEff(b) - (f.alive ? hpEff(f) : 0)
    if (lost <= 0) continue
    if (f.team === team) {
      friendly += lost + (f.alive ? 0 : b.maxHp)
      worstPct = Math.max(worstPct, lost / Math.max(1, b.hp))
    } else if (!isStaticFighter(f)) enemy += lost + (f.alive ? 0 : 0.5 * b.maxHp)
  }
  return { worstPct, friendly, enemy }
}

/**
 * Victime candidate au split léthal (§6.7) : ennemi laissé presque mort (0 < PV ≤ 8 % PVmax), ou tué par ce lancer.
 * Pour un mort, le split est toujours tenté (2 à 3 nœuds, un par chemin) : `lethalSplit` rejoue le lancer en jets
 * 'min'/'max' et conclut p = 1 si le jet minimal tue. Un filtre analytique (espérance DPT > PV de 8 %) laissait passer
 * des kills incertains : sort qui ne tue que sur critique (espérance gonflée par les critiques), sorts dont le DPT
 * surestime les dégâts immédiats.
 */
function splitVictim(ctx: TacticalContext, parent: FightState, child: FightState, m: MacroAction): number {
  if (!m.cast || m.seq) return -1
  const band = ctx.cfg.theta.tactical.lethalBand
  for (const f of child.fighters) {
    const b = parent.fighters[f.id]
    if (!b || !b.alive || b.team === ctx.view.team || isStaticFighter(b)) continue
    if (f.alive) {
      if (f.hp + f.shield < b.hp + b.shield && f.hp > 0 && f.hp <= band * f.maxHp) return f.id
      continue
    }
    return f.id
  }
  return -1
}

/** Développe un enfant (§8.2 `expand`) ; null si la macro échoue ou est rejetée. */
function expand(ctx: TacticalContext, node: SearchNode, m: MacroAction, salt: number): SearchNode | null {
  const engine = ctx.view.engine
  const meId = ctx.view.me.id
  const mode = ctx.mode ?? ctx.cfg.mode
  let s = simClone(ctx.view, node.s, salt)
  ctx.nodes.spend(1)
  if (!applyMacro(engine, s, meId, m)) return null
  const me = s.fighters[meId]
  const won = s.ended && s.winner === ctx.view.team
  if (!me || (!me.alive && !won)) return null // C9 : le lanceur meurt
  const ff = friendlyFire(node.s, s, ctx.view.team)
  if (ff.worstPct > 0.2 && ff.enemy < 2 * ff.friendly) return null // C9 : tir ami sans gain ≥ 2×
  let e = evalLeaf(ctx, s, { terminal: false })
  let v = e.v
  // Groupes aléatoires : deuxième sel, moyenne (hors fast).
  if (mode !== 'fast' && m.cast && !ctx.nodes.exhausted()) {
    const me0 = node.s.fighters[meId]
    const p = me0 ? profileOf(ctx, me0, m.cast.spellId) : undefined
    if (p?.prof.hasRandomGroups) {
      const s2 = simClone(ctx.view, node.s, (salt ^ 0x9e3779b9) >>> 0)
      ctx.nodes.spend(1)
      if (applyMacro(engine, s2, meId, m)) v = 0.5 * (v + evalLeaf(ctx, s2, { terminal: false }).v)
    }
  }
  let adj = node.adj
  let split = node.split
  // Split léthal (standard/deep, un par chemin).
  if (mode !== 'fast' && !ctx.nested && !node.split && !ctx.nodes.exhausted()) {
    const victim = splitVictim(ctx, node.s, s, m)
    if (victim >= 0) {
      const ls = lethalSplit(viewOn(ctx.view, node.s), node.s, meId, m, victim, salt, ctx.perception)
      if (ls) {
        ctx.nodes.spend(ls.nodes)
        // Un split par chemin : marqué seulement s'il modifie le nœud (un lancer non léthal, p ≈ 0, laisse le split
        // au lancer suivant qui peut tuer).
        if (ls.p > 0.02 && ls.p < 0.98 && ls.killed && ls.survived) {
          split = true
          const vk = evalLeaf(ctx, ls.killed, { terminal: false })
          const vs = evalLeaf(ctx, ls.survived, { terminal: false })
          const mixed = ls.p * vk.v + (1 - ls.p) * vs.v
          const follow = ls.p >= 0.5 ? { st: ls.killed, ev: vk } : { st: ls.survived, ev: vs }
          s = follow.st
          e = follow.ev
          adj += mixed - follow.ev.v
          v = follow.ev.v
        } else if (ls.p <= 0.02 && ls.survived && !s.fighters[victim].alive) {
          split = true
          s = ls.survived
          e = evalLeaf(ctx, s, { terminal: false })
          v = e.v
        }
      }
    }
  }
  // Cohérence (§9.3) : l'action que le rollout de l'allié précédent prêtait à ce combattant.
  if (node.depth === 0 && ctx.expectedKey !== undefined && m.key === ctx.expectedKey) adj += ctx.cfg.theta.team.coherenceBonus
  const tactics = m.tactic && !node.tactics.includes(m.tactic) ? [...node.tactics, m.tactic] : node.tactics
  return {
    s,
    hash: stateHash(s),
    depth: node.depth + 1,
    actions: [...node.actions, m],
    v: v + adj,
    breakdown: e.b,
    adj,
    split,
    tactics,
    cats: [...node.cats, m.cat],
    hasMandatory: node.hasMandatory || m.mandatory === true,
    digests: [...node.digests, digestOf(node.s, s, meId)],
  }
}

/** Signature structurelle d'un nœud : multiensemble des catégories + premier sort. */
function signature(n: SearchNode): string {
  const cats = n.cats.slice().sort().join(',')
  const first = n.actions[0]?.cast?.spellId ?? (n.actions[0]?.seq?.[0]?.cast?.spellId ?? -1)
  return `${cats}|${first}`
}

const nodeOrder = (a: SearchNode, b: SearchNode): number => b.v - a.v || keyOf(a).localeCompare(keyOf(b))
const keyOf = (n: SearchNode): string => n.actions.map(m => m.key).join('>')

/** Sélection diversifiée du faisceau (§8.2). */
export function selectDiverse(children: SearchNode[], width: number, rootV: number, margin: number): SearchNode[] {
  if (children.length <= width) return children.slice().sort(nodeOrder)
  const sorted = children.slice().sort(nodeOrder)
  const out: SearchNode[] = []
  const used = new Set<SearchNode>()
  const sigCount = new Map<string, number>()
  const take = (n: SearchNode): void => {
    out.push(n)
    used.add(n)
    const sg = signature(n)
    sigCount.set(sg, (sigCount.get(sg) ?? 0) + 1)
  }
  const best = sorted[0]
  take(best)
  // Emplacement réservé : meilleur enfant contenant une action non offensive, s'il reste dans la marge.
  if (width > 1) {
    const floor = best.v - margin * Math.abs(best.v - rootV)
    const alt = sorted.find(n => !used.has(n) && n.cats.some(c => c !== 'damage') && n.v >= floor)
    if (alt) take(alt)
  }
  for (const n of sorted) {
    if (out.length >= width) break
    if (used.has(n)) continue
    if ((sigCount.get(signature(n)) ?? 0) >= 2) continue
    take(n)
  }
  for (const n of sorted) {
    if (out.length >= width) break
    if (!used.has(n)) take(n)
  }
  return out
}

/** PM dépensés par un plan (départage : moins de PM). */
function mpUsed(f: FinalLeaf): number {
  let n = 0
  const walk = (m: MacroAction): void => {
    if (m.path) n += Math.max(0, m.path.length - 1)
    if (m.seq) for (const x of m.seq) walk(x)
  }
  for (const m of f.node.actions) walk(m)
  if (f.endPath) n += f.endPath.length - 1
  return n
}

/** Départage stable de deux plans complets. */
function finalOrder(a: FinalLeaf, b: FinalLeaf): number {
  if (b.v !== a.v) return b.v - a.v
  const dm = mpUsed(a) - mpUsed(b)
  if (dm) return dm
  const pa = a.node.actions[0]?.prior ?? 0
  const pb = b.node.actions[0]?.prior ?? 0
  if (pa !== pb) return pb - pa
  return keyOf(a.node).localeCompare(keyOf(b.node))
}

/** Plan purement offensif (aucune action non `damage`, déplacement de fin exclu). */
function offensive(n: SearchNode): boolean {
  return n.cats.every(c => c === 'damage')
}

/** Macro du déplacement de fin. */
function endMoveMacro(path: number[]): MacroAction {
  return { path, cat: 'placement', prior: 0, key: `move:${path[path.length - 1]}` }
}

/** Plan extrait d'une feuille terminale. */
function extractPlan(ctx: TacticalContext, f: FinalLeaf, pass: FinalLeaf): SearchPlan {
  const actions = f.node.actions.slice()
  const digests = f.node.digests.slice()
  if (f.endPath && f.endPath.length > 1) {
    actions.push(endMoveMacro(f.endPath))
    digests.push(digestOf(f.node.s, f.s, ctx.view.me.id))
  }
  const tactics: TacticId[] = []
  for (const t of f.node.tactics) if (!tactics.includes(t)) tactics.push(t)
  return {
    actions,
    value: f.v - pass.v,
    breakdown: f.breakdown,
    nodes: ctx.nodes.used,
    tactics,
    digests,
    leafV: f.v,
    passV: pass.v,
    rootV: pass.vTerminal,
    hasMandatory: f.node.hasMandatory,
    passBreakdown: pass.breakdown,
  }
}

/** Meilleur plan du tour pour `ctx.view.me` (§8.2). */
export function searchTurn(ctx: TacticalContext): SearchPlan {
  const mode = ctx.mode ?? ctx.cfg.mode
  const b = ctx.isKey && mode === 'standard' ? boostBudget(ctx.budget) : ctx.budget
  const theta = ctx.cfg.theta
  const rootNode = makeRootNode(ctx)
  const rootV = rootNode.v
  let beam: SearchNode[] = [rootNode]
  const leaves: SearchNode[] = []
  const seen = new Map<bigint, number>()
  seen.set(rootNode.hash, rootNode.v)
  // Réserve de nœuds pour les déplacements de fin (« rien » + finales) et les rollouts : le faisceau ne l'entame pas.
  const nFinals = Math.max(2, 2 * b.width)
  const rolloutsWanted = ctx.nested || ctx.noRollouts ? 0 : b.rollouts
  const reserve = Math.min(Math.floor(ctx.nodes.remaining() / 3), b.endCells * Math.min(nFinals + 1, 5) + rolloutsWanted * 14)
  const bctx: TacticalContext = { ...ctx, nodes: subBudget(ctx.nodes, ctx.nodes.remaining() - reserve) }
  for (let depth = 0; depth < b.maxDepth && beam.length && !bctx.nodes.exhausted(); depth++) {
    const children: SearchNode[] = []
    for (const node of beam) {
      if (bctx.nodes.exhausted()) break
      const me = node.s.fighters[ctx.view.me.id]
      if (!me || !me.alive || node.s.ended || me.ap <= 0) continue
      const salt = simSalt(node.hash, depth)
      for (const c of selectForSim(bctx, node, generate(bctx, node), b)) {
        if (bctx.nodes.exhausted()) break
        const child = expand(bctx, node, c, salt)
        if (!child) continue
        ctx.trace?.({ t: 'expand', depth, key: c.key, v: child.v, tactic: c.tactic, cat: c.cat, mandatory: c.mandatory === true })
        const prev = seen.get(child.hash)
        if (prev !== undefined && prev >= child.v) continue
        seen.set(child.hash, child.v)
        children.push(child)
        leaves.push(child)
      }
    }
    beam = selectDiverse(children, Math.max(1, b.width), rootV, theta.tactical.diversityMargin)
  }
  // Plans complets : déplacement de fin et V terminale.
  const pass = finalize(ctx, rootNode)
  const finals = leaves.sort(nodeOrder).slice(0, nFinals).map(n => finalize(ctx, n))
  finals.sort(finalOrder)
  let pool = finals
  const rollouts = ctx.nested || ctx.noRollouts ? 0 : b.rollouts
  if (rollouts > 0 && finals.length) {
    pool = finals.slice(0, rollouts)
    for (const f of [pass, ...pool]) {
      if (ctx.nodes.exhausted()) break
      const r = teamRollout(ctx, f)
      if (r === undefined) continue
      f.rollout = r
      // Corrections du chemin (split léthal, cohérence) : portées aussi par la valeur déroulée.
      f.v = 0.5 * f.vTerminal + 0.5 * (r + f.node.adj)
      f.rolled = true
    }
    // Plans comparables : déroulés (et « rien » déroulé) ; sinon repli sur la V terminale.
    if (pass.rolled) pool = pool.filter(f => f.rolled)
    else {
      for (const f of pool) f.v = f.vTerminal
      pool = finals
    }
    pool.sort(finalOrder)
  }
  for (const f of pool) ctx.trace?.({ t: 'final', keys: f.node.actions.map(m => m.key), v: f.v, rolled: f.rolled })
  const best = pool[0]
  const minGain = theta.value.minGain
  const chosen = best && (best.v - pass.v >= minGain || best.node.hasMandatory) ? best : pass
  const plan = extractPlan(ctx, chosen, pass)
  if (chosen.expect) ctx.expect?.(chosen.expect.allyId, chosen.expect.key)
  ctx.trace?.({ t: 'choice', keys: plan.actions.map(m => m.key), v: chosen.v, pass: pass.v })
  // Décisions clés et marquage créatif.
  const second = pool.find(f => f !== chosen && firstKey(f) !== firstKey(chosen))
  plan.closeCall = !!second && Math.abs(chosen.v - second.v) < 150
  let bestOff = -Infinity
  for (const f of pool) if (offensive(f.node) && f.node.actions.length && f.v > bestOff) bestOff = f.v
  plan.bestOffensive = Number.isFinite(bestOff) ? bestOff - pass.v : 0
  plan.maxDeathRisk = maxDeathRisk(ctx, chosen.s)
  plan.creative = isCreative(chosen, pass, plan.bestOffensive)
  if (ctx.wantAlternatives) {
    const firsts = new Set<string>([firstKey(chosen)])
    plan.alternatives = []
    for (const f of pool) {
      if (plan.alternatives.length >= ctx.wantAlternatives) break
      const k = firstKey(f)
      if (firsts.has(k)) continue
      firsts.add(k)
      plan.alternatives.push(extractPlan(ctx, f, pass))
    }
  }
  plan.nodes = ctx.nodes.used
  return plan
}

function firstKey(f: FinalLeaf): string {
  return f.node.actions[0]?.key ?? (f.endPath ? `move:${f.endPath[f.endPath.length - 1]}` : 'pass')
}

/** Risque de mort maximal d'un allié dans l'état final retenu. */
function maxDeathRisk(ctx: TacticalContext, s: FightState): number {
  const p = ctx.perception as PerceptionX
  p.sync(s)
  let r = 0
  for (const f of s.fighters) if (f.alive && f.team === ctx.view.team) r = Math.max(r, p.threat.deathRisk(f.id))
  return r
}

/**
 * Marquage « créatif » (§10.3) : le plan contient une action non offensive ET (bat le meilleur plan purement offensif
 * de ≥ 15 %, ou tire ≥ 60 % de son ΔV de termes autres que enemyLife/kills).
 */
export function isCreative(chosen: FinalLeaf, pass: FinalLeaf, bestOffensiveGain: number): boolean {
  const n = chosen.node
  if (!n.actions.length || !n.cats.some((c: CandidateCat) => c !== 'damage')) return false
  const gain = chosen.v - pass.v
  if (gain <= 0) return false
  if (bestOffensiveGain > 0 && gain >= 1.15 * bestOffensiveGain) return true
  const b = chosen.breakdown
  const p0 = pass.breakdown
  const dOff = b.enemyLife - p0.enemyLife + (b.kills - p0.kills)
  const dTot = b.total - p0.total
  return dTot > 0 && (dTot - dOff) / dTot >= 0.6
}
