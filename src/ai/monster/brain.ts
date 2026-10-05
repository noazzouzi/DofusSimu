/**
 * Cerveau des monstres (docs/design/ai.md §11 ; docs/research/monster-ai.md §8.2-§8.6) — WP1.
 *
 * IA générique GLOUTONNE, fidèle à l'IA officielle (« une seule IA générale », R25 : bornée en calcul), qui replanifie
 * après CHAQUE action (R10, R11, R18) :
 *
 *   playTurn : (effets TB déjà appliqués par startTurn, R19)
 *     tour annulé / statique / ne peut pas jouer → rien (corrompus du Vortex, Auroraire : T10)
 *     hooks.beforeTurn (Heurage, En temps et en heure du Vortex)
 *     ≤ 12 pas : candidats (socle `generateCasts` : sorts × cases de lancer de l'accessibilité avec tacle × cibles,
 *       centres de zone touchant ≥ 1 combattant — R2, case actuelle seule à 0 PM — R24) → filtres durs (profil,
 *       hooks, R14) → préfiltre analytique `quickMonster` → topK simulés sur clones honnêtes (`simClone` : 'average',
 *       pièges cachés retirés, dés re-semés) + obligatoires → score PVe §11.4 (+ Δposition) → meilleur candidat ;
 *       arrêt si le meilleur < `minActionScore` (« passer » après un kill)
 *     bascule peureux R12/R13 (`tags.aiFearAggro`, clonée avec l'état : la prédiction rejoue le même cerveau)
 *     déplacement de fin de tour par comportement (position.ts)
 *
 * Réglages (§11.1) : `play` = topK 8 + obligatoires (`openers`, `alwaysCastWhenReady`, buff sans cible — au plus 3
 * variantes forcées par sort —, candidats des hooks, variantes de case de lancer des kiters / peureux / soutiens,
 * exploration : sorts à couverture analytique < 1 à moins de 15 % du meilleur préfiltre), utilisé pour TOUT tour réel
 * de monstre quel que soit le mode des joueurs ; `predict` = topK 4 sans exploration (rollouts des joueurs) ;
 * `reference` = topK 24, sans élagage (test d'équivalence seulement). Bruit optionnel `noiseTau` (softmax sur le top-3,
 * flux RNG IA). Départage déterministe : `castOrder` du profil, priorités de Stump (invocation > buff > dégâts > soin >
 * malus), moins de PM, puis hachage de la clé avec la graine IA du tour (« RNG IA », indépendant des candidats).
 *
 * Économies de simulation (nœud mesuré ≈ 3× l'hypothèse de 70 µs du design, §14.2) : hors `reference`, un candidat à
 * préfiltre exact (couverture ≥ 0,9) sous 30 % du meilleur n'est pas simulé ; les variantes d'un même lancer monocible
 * sans déplacement (même sort, même cible, même nature mêlée / distance) partagent une simulation, la position étant
 * réévaluée par variante. Accord mesuré play/reference ≥ 99 % (tests/ai-monster-equivalence.test.ts).
 */
import { mix32 } from '../../core/hash'
import type { Engine } from '../../engine/engine'
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, CELL_X, CELL_Y, distance } from '../../map/geometry'
import { GridSearch } from '../../map/path'
import { zoneMembership } from '../../map/zones'
import { castCellsFor, castFailureStatic, levelFor, LosOracle } from '../core/castCells'
import { generateCasts } from '../core/candidates'
import { buildOccupancy, cachedReach, mpSpent, reachPath } from '../core/reach'
import { decisionRng, detExp } from '../core/rng'
import { applyMacro, simClone } from '../core/sim'
import { canPlay } from '../core/timeline'
import type { AIConfig, CandidateCat, MacroAction, MonsterController, MonsterSetting } from '../types'
import { MonsterContext } from './context'
import { buildFrame, finalMove, posScore, type PosFrame } from './position'
import { followUpScore, quickMonster, scoreTransition, totalOf } from './score'
import type { MonsterBrainStats, MonsterCandidate, MonsterDecision, ScoreParts } from './types'

/** Nombre maximal de pas (lancers / déplacements) par tour (§11.2). */
export const MAX_STEPS = 12
/** Marge relative d'égalité des scores (départage). */
const TIE_EPS = 1e-6
/** Élagage par dominance du préfiltre (play / predict) : ratio au meilleur préfiltre et couverture analytique minimale. */
export const PRUNE_RATIO = 0.3
export const PRUNE_COVERAGE = 0.9
/** Priorités de Stump par catégorie (invocation 5 > buff 4 > dégâts 3 > soin 2 > malus 1). */
const STUMP_PRIORITY: Record<CandidateCat, number> = { summon: 5, buff: 4, damage: 3, heal: 2, control: 1, placement: 1, mark: 1, utility: 1 }

const SEARCH = new GridSearch()

export class MonsterBrain implements MonsterController {
  readonly stats: MonsterBrainStats = { turns: 0, steps: 0, simulations: 0, candidates: 0, casts: 0, moves: 0 }

  constructor(
    readonly cfg: AIConfig,
    readonly setting: MonsterSetting = 'play',
  ) {}

  /** topK simulés selon le réglage (§11.1). */
  get topK(): number {
    const m = this.cfg.monster
    return this.setting === 'predict' ? m.predictTopK : this.setting === 'reference' ? m.referenceTopK : m.topK
  }

  /** Le combattant joue-t-il ce tour ? (tour annulé, `cannotPlay`, `preventsFight`, statique, mort). */
  static plays(engine: Engine, fight: FightState, me: Fighter): boolean {
    return me.alive && !fight.ended && !engine.passesTurn(me) && canPlay(engine, me) && !isStaticFighter(me)
  }

  playTurn(engine: Engine, fight: FightState, me: Fighter): void {
    if (!MonsterBrain.plays(engine, fight, me)) return
    const ctx = new MonsterContext(engine, fight, me, this.cfg, this.setting)
    if (ctx.baseBehaviour === 'static') return
    this.stats.turns++
    const before = ctx.profile.hooks?.beforeTurn?.(ctx) ?? []
    for (const a of before) {
      if (fight.ended || !me.alive) break
      if (a.type === 'cast' && !ctx.canCastOn(a.spellId, a.cell)) continue
      if (ctx.perform(a)) {
        if (a.type === 'cast') {
          this.stats.casts++
          ctx.note('intent', `${me.name} : ${spellName(me, a.spellId)} (début de tour)`, [a.cell])
        } else this.stats.moves++
      }
    }
    let failures = 0
    for (let step = 0; step < MAX_STEPS && me.alive && !fight.ended && !me.tags.endTurnNow; step++) {
      const d = this.pickBestAction(ctx)
      if (!d || d.score < ctx.w.minActionScore) break
      if (!this.execute(ctx, d) && ++failures >= 2) break
    }
    updateFearfulMode(ctx)
    if (me.alive && !fight.ended && finalMove(ctx)) this.stats.moves++
  }

  /**
   * Premier choix du tour sans rien jouer (tests d'équivalence et de déterminisme, prévisions) : candidat retenu par
   * `pickBestAction` sur l'état courant, ou null (« passer »). Les hooks `beforeTurn` ne sont pas joués.
   */
  decide(engine: Engine, fight: FightState, me: Fighter): MonsterDecision | null {
    if (!MonsterBrain.plays(engine, fight, me)) return null
    const ctx = new MonsterContext(engine, fight, me, this.cfg, this.setting)
    if (ctx.baseBehaviour === 'static') return null
    const d = this.pickBestAction(ctx)
    return d && d.score >= ctx.w.minActionScore ? d : null
  }

  /** Joue une décision : déplacement puis lancer (si le monstre est bien arrivé sur sa case de lancer). */
  private execute(ctx: MonsterContext, d: MonsterDecision): boolean {
    const me = ctx.me
    const c = d.cand
    if (c.path && c.path.length > 1) {
      const ok = ctx.perform({ type: 'move', path: c.path })
      if (ok) this.stats.moves++
      if (!ok || me.cell !== c.from) return false
    }
    if (!c.cast || !me.alive || ctx.fight.ended) return true
    const ok = ctx.perform({ type: 'cast', spellId: c.cast.spellId, cell: c.cast.cell })
    if (ok) {
      this.stats.casts++
      ctx.offensive ||= d.parts.offensive
      const t = ctx.fighterAt(c.cast.cell)
      ctx.note('focus', `${me.name} : ${spellName(me, c.cast.spellId)}${t && t.id !== me.id ? ` sur ${t.name}` : ''} (${Math.round(d.score)} PVe)`,
        [c.cast.cell], t ? [t.id] : undefined)
    }
    return ok
  }

  /** Un pas : meilleur candidat simulé (voir l'en-tête), ou null s'il n'y a rien d'utile. */
  pickBestAction(ctx: MonsterContext): MonsterDecision | null {
    const me = ctx.me
    const fight = ctx.fight
    if (!me.alive || fight.ended) return null
    this.stats.steps++
    const cands = generate(ctx)
    if (!cands.length) return null
    this.stats.candidates += cands.length
    const w = ctx.w
    const behaviour = ctx.behaviour
    const frame0 = buildFrame(ctx, fight, behaviour)
    const pos0 = posScore(frame0, me.cell)
    for (const c of cands) c.prior = quickMonster(ctx, c, w.positionDuringTurn * (posScore(frame0, c.from) - pos0))
    markMandatory(ctx, cands, this.setting)
    cands.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const k = this.topK
    const selected: MonsterCandidate[] = []
    let anyMandatory = false
    const bestPrior = cands[0].prior
    const prune = this.setting !== 'reference' && bestPrior > 0
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i]
      if (c.mandatory) anyMandatory = true
      if (!(i < k || c.mandatory)) continue
      // Dominance (hors `reference`) : un candidat dont le préfiltre est EXACT (couverture analytique ≥ 0,9) et
      // inférieur à 30 % du meilleur n'est pas simulé (§14.2 : nœud mesuré ≈ 3× l'hypothèse du design).
      if (prune && i > 0 && !c.mandatory && c.prior < PRUNE_RATIO * bestPrior && (ctx.spellProfiles()[c.spellIndex]?.analyticCoverage ?? 0) >= PRUNE_COVERAGE) continue
      selected.push(c)
    }
    if (!anyMandatory && cands[0].prior < w.minActionScore / 2) return null
    // Variantes de case de lancer (positionnement, pas exploration) : dans tous les réglages — sans elles, `predict`
    // ne prévoit plus où finit un kiter (accord predict/play 83 % au lieu de 97 %).
    addAltCells(ctx, selected, frame0, Math.min(3, k))
    // Simulation : même sel pour tous les frères (nombres aléatoires communs, jamais l'état réel des dés).
    const salt = mix32(mix32(this.cfg.seed ^ 0x6d6f6e, fight.round), me.id * 64 + (ctx.step & 63))
    const look = ctx.profile.lookahead
    const order = look && look.length ? [...selected.filter(c => !look.includes(c.cast?.spellId ?? -1)), ...selected.filter(c => look.includes(c.cast?.spellId ?? -1))] : selected
    let best: MonsterDecision | null = null
    let bestForced: MonsterDecision | null = null
    let bestDirect = 0
    const scored: MonsterDecision[] = []
    const rankOf = new Map<MonsterCandidate, number>()
    cands.forEach((c, i) => rankOf.set(c, i))
    // Variantes d'un même lancer (même sort, même cible, même nature mêlée/distance) qui ne diffèrent que par la case
    // de lancer d'un sort sans déplacement ni zone : une seule simulation, la position est réévaluée par variante.
    const shared = new Map<string, { clone: FightState; parts: ScoreParts } | null>()
    for (const c of order) {
      const sk = shareKey(ctx, c)
      const prev = sk ? shared.get(sk) : undefined
      let clone: FightState
      let parts: ScoreParts
      if (prev === null) continue
      if (prev) {
        clone = prev.clone
        parts = { ...prev.parts }
      } else {
        clone = simClone(ctx.view, fight, salt)
        this.stats.simulations++
        if (!applyMacro(ctx.engine, clone, me.id, c)) {
          if (sk) shared.set(sk, null)
          continue
        }
        parts = scoreTransition(ctx, clone, c)
        if (sk) shared.set(sk, parts.casterDead ? null : { clone, parts: { ...parts } })
      }
      if (parts.casterDead) continue
      if (parts.blocked) ctx.sawBlocked = true
      const me1 = clone.fighters[me.id]
      const frame1 = sameFrame(frame0, fight, clone, me.id) ? frame0 : buildFrame(ctx, clone, behaviour)
      parts.position = me1.alive ? w.positionDuringTurn * (posScore(frame1, prev ? c.from : me1.cell) - pos0) : 0
      let total = totalOf(parts)
      const hook = ctx.profile.hooks?.scoreCast
      if (hook) total = hook(ctx, c, total, clone)
      if (look && c.cast && look.includes(c.cast.spellId)) {
        let next = 0
        for (const ks of me.spells) if (ks.spellId !== c.cast.spellId) next = Math.max(next, followUpScore(ctx, clone, ks.spellId))
        total += Math.max(0, next - bestDirect)
      } else if (total > bestDirect) bestDirect = total
      parts.total = total
      const d: MonsterDecision = { cand: c, score: total, parts, rank: rankOf.get(c) ?? -1, simulated: 0, candidates: cands.length, mandatory: 0, bestPrior: cands[0].prior }
      scored.push(d)
      if (!best || better(ctx, this.cfg.seed, d, best)) best = d
      // Obligatoire « forcé » (ouverture, « dès que prêt », buff sans cible) : joué dès qu'il ne nuit pas.
      if (c.forced && total >= 0 && (!bestForced || better(ctx, this.cfg.seed, d, bestForced))) bestForced = d
    }
    const chosen = bestForced ?? this.noisy(ctx, scored, best)
    const mandatory = selected.filter(c => c.mandatory).length
    for (const d of scored) {
      d.simulated = scored.length
      d.mandatory = mandatory
    }
    // Un forcé de valeur nulle passe le seuil d'action (il est joué « par principe », monster-ai.md §7.2).
    if (chosen && chosen === bestForced && chosen.score < w.minActionScore) chosen.score = w.minActionScore
    this.lastScored = scored
    this.lastChosen = chosen
    return chosen
  }

  /** Candidats simulés du dernier pas (classement de `decideTop`). */
  private lastScored: MonsterDecision[] = []
  private lastChosen: MonsterDecision | null = null

  /**
   * Classement du premier pas du tour (sans rien jouer) : la décision retenue d'abord, puis les autres candidats
   * simulés par préférence décroissante (score, puis départages) ; `n` premiers. Sert aux rollouts des joueurs
   * (§8.6 : « 2e choix du monstre le plus menaçant ») et aux tests.
   */
  decideTop(engine: Engine, fight: FightState, me: Fighter, n = 2): MonsterDecision[] {
    if (!MonsterBrain.plays(engine, fight, me)) return []
    const ctx = new MonsterContext(engine, fight, me, this.cfg, this.setting)
    if (ctx.baseBehaviour === 'static') return []
    this.lastScored = []
    this.lastChosen = null
    this.pickBestAction(ctx)
    const chosen = this.lastChosen as MonsterDecision | null
    const rest = this.lastScored.filter(d => d !== chosen && d.score >= ctx.w.minActionScore)
    rest.sort((a, b) => (better(ctx, this.cfg.seed, a, b) ? -1 : better(ctx, this.cfg.seed, b, a) ? 1 : 0))
    const out = chosen && chosen.score >= ctx.w.minActionScore ? [chosen, ...rest] : rest
    return out.slice(0, n)
  }

  /** Bruit optionnel (`noiseTau` > 0, hors `reference`) : tirage softmax sur le top-3 (flux RNG IA). */
  private noisy(ctx: MonsterContext, scored: MonsterDecision[], best: MonsterDecision | null): MonsterDecision | null {
    const tau = this.cfg.monster.noiseTau
    if (!best || !(tau > 0) || this.setting === 'reference' || scored.length < 2) return best
    const top = scored.slice().sort((a, b) => (better(ctx, this.cfg.seed, a, b) ? -1 : better(ctx, this.cfg.seed, b, a) ? 1 : 0)).slice(0, 3)
    const t = tau * Math.max(1, Math.abs(top[0].score))
    const wts = top.map(d => detExp((d.score - top[0].score) / t))
    const sum = wts.reduce((a, b) => a + b, 0)
    let r = decisionRng(this.cfg.seed, ctx.me.id, ctx.fight.round, ctx.step).next() * sum
    for (let i = 0; i < top.length; i++) {
      r -= wts[i]
      if (r <= 0) return top[i]
    }
    return top[top.length - 1]
  }
}

/** Nom d'un sort connu (journal). */
function spellName(me: Fighter, spellId: number): string {
  return me.spells.find(s => s.spellId === spellId)?.name ?? `sort ${spellId}`
}

/**
 * Clé de partage de simulation (voir la boucle de `pickBestAction`) : sort monocible sans déplacement (de personne),
 * sans invocation ni marque, sans sous-sort autour du lanceur ; null si le lancer dépend de la case de lancer.
 */
function shareKey(ctx: MonsterContext, c: MonsterCandidate): string | null {
  if (!c.cast || c.spellIndex < 0) return null
  const p = ctx.spellProfiles()[c.spellIndex]
  if (!p || p.zoneRadius !== 0 || p.moves.length || p.summonLines.length || p.glyph || p.trap || p.maxRange === 0) return null
  if (p.damage.some(d => d.aroundCaster)) return null
  return `${c.cast.spellId}:${c.cast.cell}:${distance(c.from, c.cast.cell) <= 1 ? 'm' : 'r'}`
}

/** `a` est-il préférable à `b` ? Score, puis `castOrder`, priorités de Stump, moins de PM, hachage de la clé. */
function better(ctx: MonsterContext, seed: number, a: MonsterDecision, b: MonsterDecision): boolean {
  const eps = TIE_EPS * Math.max(1, Math.abs(a.score), Math.abs(b.score))
  if (a.score > b.score + eps) return true
  if (b.score > a.score + eps) return false
  const co = ctx.profile.castOrder
  if (co) {
    const ra = rankIn(co, a.cand.cast?.spellId)
    const rb = rankIn(co, b.cand.cast?.spellId)
    if (ra !== rb) return ra < rb
  }
  const pa = STUMP_PRIORITY[a.cand.cat] ?? 0
  const pb = STUMP_PRIORITY[b.cand.cat] ?? 0
  if (pa !== pb) return pa > pb
  const ma = a.cand.path ? a.cand.path.length : 0
  const mb = b.cand.path ? b.cand.path.length : 0
  if (ma !== mb) return ma < mb
  return keyHash(seed, ctx, a.cand.key) > keyHash(seed, ctx, b.cand.key)
}

function rankIn(order: readonly number[], spellId: number | undefined): number {
  const i = spellId === undefined ? -1 : order.indexOf(spellId)
  return i < 0 ? order.length : i
}

function keyHash(seed: number, ctx: MonsterContext, key: string): number {
  let h = mix32(seed, ctx.me.id * 1000 + ctx.fight.round)
  for (let i = 0; i < key.length; i++) h = mix32(h, key.charCodeAt(i))
  return h >>> 0
}

/** Les positions et vies de tous les autres combattants sont-elles identiques (cadre de position réutilisable) ? */
function sameFrame(frame: PosFrame, root: FightState, s: FightState, meId: number): boolean {
  if (s.fighters.length !== root.fighters.length || s.glyphs.length !== root.glyphs.length) return false
  for (let i = 0; i < root.fighters.length; i++) {
    if (i === meId) continue
    const a = root.fighters[i]
    const b = s.fighters[i]
    if (a.alive !== b.alive || a.cell !== b.cell) return false
  }
  return frame.s === root
}

// ───────────────────────────── génération ─────────────────────────────

/** Le sort a-t-il des dégâts sur les ennemis ? */
function damaging(ctx: MonsterContext, c: MonsterCandidate): boolean {
  if (c.spellIndex < 0) return false
  const p = ctx.spellProfiles()[c.spellIndex]
  return !!p && p.damage.some(d => d.sides.enemy)
}

/** Zone « toute la carte » (Petit poison, Décollage) : la case de lancer n'importe pas. */
function wholeMap(ctx: MonsterContext, c: MonsterCandidate): boolean {
  const p = ctx.spellProfiles()[c.spellIndex]
  return !!p && p.zone?.shape === 'a' && p.maxRange === 0
}

/**
 * Candidats d'un pas : génération générique du socle (C1-C8) + candidats des hooks, puis filtres durs (sorts interdits,
 * `filterCast`, rapprochement « gapCloser », pièges sur son propre chemin — R14, invocation sur glyphe adverse — R3,
 * doublons des sorts « toute la carte »).
 */
function generate(ctx: MonsterContext): MonsterCandidate[] {
  const me = ctx.me
  // Aucun sort lançable (PA, relances, lancers par tour, états) : pas de génération (pas d'arrêt fréquent en fin de tour).
  let any = false
  for (const ks of me.spells) {
    if (castFailureStatic(ctx.engine, me, ks, levelFor(me, ks), me.ap) === null) {
      any = true
      break
    }
  }
  const extra = ctx.profile.hooks?.extraCandidates?.(ctx) ?? []
  if (!any && !extra.length) return []
  const raw = generateCasts(ctx.view, ctx.fight, me, { withPrior: false, unsupportedSpells: ctx.cfg.unsupportedSpells })
  const out: MonsterCandidate[] = []
  const seen = new Set<string>()
  const push = (m: MacroAction, reason?: string) => {
    if (!m.cast || seen.has(m.key)) return
    const spellIndex = me.spells.findIndex(s => s.spellId === m.cast!.spellId)
    if (spellIndex < 0) return
    const from = m.path && m.path.length ? m.path[m.path.length - 1] : me.cell
    const c: MonsterCandidate = { ...m, spellIndex, from }
    if (reason) {
      c.reason = reason
      c.mandatory = true
    }
    seen.add(m.key)
    out.push(c)
  }
  for (const m of raw) push(m)
  for (const m of extra) push(m, 'hook')
  const profile = ctx.profile
  const forbid = profile.forbidSpells
  const filter = profile.hooks?.filterCast
  const gap = profile.gapCloser
  let gapBlocked = false
  if (gap && out.some(c => c.cast!.spellId === gap.spellId)) {
    // Un ennemi atteignable en ligne à ≤ lineRange depuis une case accessible ce tour : pas de rapprochement.
    const lr = gap.lineRange ?? 7
    const reach = cachedReach(ctx.engine, ctx.fight, me, ctx.team, me.mp, me.ap, buildOccupancy(ctx.fight, ctx.team))
    const enemies = ctx.enemies().map(e => e.cell)
    for (let i = 0; i < reach.count && !gapBlocked; i++) {
      const c = reach.cells[i]
      for (const ec of enemies) {
        if (lineDistance(c, ec) <= lr) {
          gapBlocked = true
          break
        }
      }
    }
  }
  const wholeSeen = new Set<number>()
  const result: MonsterCandidate[] = []
  for (const c of out) {
    const spellId = c.cast!.spellId
    if (forbid?.includes(spellId)) continue
    if (gap && spellId === gap.spellId && gapBlocked) continue
    if (wholeMap(ctx, c)) {
      if (wholeSeen.has(spellId) || c.from !== me.cell) continue
      wholeSeen.add(spellId)
    }
    if (!trapSafe(ctx, c) || !summonSafe(ctx, c)) continue
    if (filter && !filter(ctx, c)) continue
    result.push(c)
  }
  return result
}

/** Distance si les cases sont alignées, sinon l'infini. */
function lineDistance(a: number, b: number): number {
  const ax = cellX(a)
  const ay = cellY(a)
  const bx = cellX(b)
  const by = cellY(b)
  if (ax !== bx && ay !== by) return Infinity
  return Math.abs(ax - bx) + Math.abs(ay - by)
}

function cellX(c: number): number {
  return CELL_X[c]
}
function cellY(c: number): number {
  return CELL_Y[c]
}

/**
 * R14 : un piège posé ne doit pas couvrir la case de lancer ni le début du plus court chemin vers la focale (sur les PM
 * restants) — le monstre ne pose pas de piège qu'il déclencherait en se déplaçant.
 */
function trapSafe(ctx: MonsterContext, c: MonsterCandidate): boolean {
  const p = ctx.spellProfiles()[c.spellIndex]
  if (!p || !p.trap) return true
  const zoneSpec = ctx.me.spells[c.spellIndex].level.effects.find(e => e.effectId === 400)?.zone ?? p.zone
  if (!zoneSpec) return true
  const inZone = zoneMembership(zoneSpec, c.cast!.cell, c.from)
  if (inZone(c.from)) return false
  const focal = ctx.focal()
  if (!focal) return true
  const fight = ctx.fight
  const occ = buildOccupancy(fight, ctx.team)
  const mpLeft = Math.max(0, Math.floor(ctx.me.mp) - (c.path ? c.path.length - 1 : 0))
  SEARCH.run(c.from, x => !!fight.map.cells[x]?.walkable && (occ[x] < 0 || occ[x] === ctx.me.id), CELL_COUNT, focal.cell)
  const path = SEARCH.pathTo(focal.cell)
  if (!path) return true
  for (let i = 1; i < path.length - 1 && i <= mpLeft; i++) if (inZone(path[i])) return false
  return true
}

/** R3 : pas d'invocation sur une glyphe posée par un ennemi. */
function summonSafe(ctx: MonsterContext, c: MonsterCandidate): boolean {
  const p = ctx.spellProfiles()[c.spellIndex]
  if (!p || !p.summonLines.length) return true
  const cell = c.cast!.cell
  for (const g of ctx.fight.glyphs) {
    const src = ctx.fight.fighters[g.sourceId]
    if (src && src.team !== ctx.team && g.cells.includes(cell)) return false
  }
  return true
}

/**
 * Candidats obligatoires (simulés hors topK) : ouvertures (si elles touchent assez d'ennemis), sorts « dès que prêts »,
 * buff sans cible (aucun sort de dégâts n'a de candidat), candidats des hooks ; exploration en `play` : sorts à
 * couverture analytique < 1 dont le préfiltre est à moins de 15 % du meilleur.
 */
function markMandatory(ctx: MonsterContext, cands: MonsterCandidate[], setting: MonsterSetting): void {
  const p = ctx.profile
  let bestPrior = -Infinity
  for (const c of cands) if (c.prior > bestPrior) bestPrior = c.prior
  const anyDamage = cands.some(c => damaging(ctx, c))
  for (const c of cands) {
    const spellId = c.cast?.spellId ?? -1
    const opener = p.openers?.find(o => o.spellId === spellId)
    if (opener && touchedEnemies(ctx, c) >= (opener.minTargets ?? 1)) {
      c.mandatory = c.forced = true
      c.reason = 'opener'
      continue
    }
    if (p.alwaysCastWhenReady?.includes(spellId)) {
      c.mandatory = c.forced = true
      c.reason = 'always'
      continue
    }
    if (p.selfBuffWhenNoTarget === spellId && !anyDamage) {
      c.mandatory = c.forced = true
      c.reason = 'selfBuff'
      continue
    }
    if (setting === 'play' && c.spellIndex >= 0 && !c.mandatory) {
      const prof = ctx.spellProfiles()[c.spellIndex]
      if (prof && prof.analyticCoverage < 1 && c.prior >= bestPrior - 0.15 * Math.abs(bestPrior) && c.prior >= ctx.w.minActionScore) {
        c.mandatory = true
        c.reason = 'explore'
      }
    }
  }
  // Au plus 3 variantes forcées par sort (meilleurs préfiltres) : une ouverture à 6 centres ne coûte pas 6 simulations.
  const bySpell = new Map<number, MonsterCandidate[]>()
  for (const c of cands) {
    if (!c.forced) continue
    const id = c.cast!.spellId
    let l = bySpell.get(id)
    if (!l) bySpell.set(id, (l = []))
    l.push(c)
  }
  for (const l of bySpell.values()) {
    if (l.length <= MAX_FORCED_PER_SPELL) continue
    l.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    for (const c of l.slice(MAX_FORCED_PER_SPELL)) {
      c.forced = false
      c.mandatory = false
      delete c.reason
    }
  }
}

/** Variantes forcées simulées par sort (ouvertures, sorts « dès que prêts », buff sans cible). */
const MAX_FORCED_PER_SPELL = 3

/** Nombre d'ennemis dans la zone d'un candidat (positions de la racine). */
function touchedEnemies(ctx: MonsterContext, c: MonsterCandidate): number {
  const p = ctx.spellProfiles()[c.spellIndex]
  if (!p || !c.cast) return 0
  let n = 0
  const zones = p.level.effects.filter(e => !e.clientOnly).map(e => zoneMembership(e.zone, c.cast!.cell, c.from))
  for (const e of ctx.enemies()) {
    const cell = e.cell
    if (zones.some(z => z(cell))) n++
  }
  return n
}

/**
 * Cases de lancer alternatives (kiter, peureux, soutien — monster-ai.md §8.5 : « la case la plus éloignée de l'ennemi
 * le plus menaçant parmi celles qui permettent le lancer ») : pour les `n` premiers candidats à cible, la case de
 * lancer valide de meilleure position (moins de PM à égalité) est ajoutée comme variante simulée.
 */
function addAltCells(ctx: MonsterContext, selected: MonsterCandidate[], frame: PosFrame, n: number): void {
  const b = frame.behaviour
  if (b !== 'kiter' && b !== 'fearful' && b !== 'support') return
  const me = ctx.me
  if (me.mp < 1) return
  const fight = ctx.fight
  const occ = buildOccupancy(fight, ctx.team)
  const reach = cachedReach(ctx.engine, fight, me, ctx.team, me.mp, me.ap, occ)
  const los = new LosOracle(fight, ctx.team, me.id, occ)
  const cells: number[] = []
  const keys = new Set(selected.map(c => c.key))
  const base = selected.filter(c => !c.forced).slice(0, n)
  for (const c of base) {
    if (!c.cast || c.spellIndex < 0) continue
    const ks = me.spells[c.spellIndex]
    const lvl = levelFor(me, ks)
    if (lvl.range === 0) continue
    castCellsFor(fight, me, ks, lvl, c.cast.cell, reach, los, 24, cells)
    let bestCell = -1
    let bestV = -Infinity
    for (const x of cells) {
      const v = posScore(frame, x) - 2 * Math.max(0, mpSpent(reach, x))
      if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && x < bestCell)) {
        bestV = v
        bestCell = x
      }
    }
    // Variante utile seulement si le gain de position pèse au moins un déplacement de fin de tour (5 PVe).
    if (bestCell < 0 || bestCell === c.from) continue
    if (ctx.w.positionDuringTurn * (posScore(frame, bestCell) - posScore(frame, c.from)) < ctx.w.endMoveMinGain) continue
    const key = `${c.cast.spellId}:${c.cast.cell}:${bestCell}`
    if (keys.has(key)) continue
    const path = bestCell === me.cell ? undefined : reachPath(reach, me.cell, bestCell) ?? undefined
    if (bestCell !== me.cell && !path) continue
    keys.add(key)
    const alt: MonsterCandidate = { ...c, key, from: bestCell, reason: 'altCell', mandatory: true, forced: false }
    if (path) alt.path = path
    else delete alt.path
    selected.push(alt)
  }
}

/**
 * Bascule peureux (R12/R13) : sans action offensive ce tour, un peureux devient agressif jusqu'à sa prochaine action
 * offensive — sauf s'il n'a rien pu infliger à cause des résistances, d'une invulnérabilité ou d'un renvoi (R13).
 */
export function updateFearfulMode(ctx: MonsterContext): void {
  if (ctx.baseBehaviour !== 'fearful') return
  if (ctx.offensive) delete ctx.me.tags.aiFearAggro
  else if (!ctx.sawBlocked && !immuneEnemyInReach(ctx)) ctx.me.tags.aiFearAggro = true
}

/**
 * R13 : un ennemi à portée d'attaque ce tour (PM + portée de ses sorts de dégâts) est-il intouchable (invulnérable, ou
 * renvoi de dommages ≥ PV du monstre) ? Les candidats contre un invulnérable sont filtrés avant simulation (C2) : la
 * condition « bloqué » est donc aussi lue directement.
 */
function immuneEnemyInReach(ctx: MonsterContext): boolean {
  const me = ctx.me
  const range = ctx.archetype.maxDamageRange
  if (range < 0) return false
  const reach = Math.max(0, Math.floor(me.mp)) + range
  for (const e of ctx.enemies()) {
    if (distance(me.cell, e.cell) > reach) continue
    if (ctx.engine.stateFlag(e, 'invulnerable') || e.stats.reflect >= me.hp) return true
  }
  return false
}

/** Cerveau de monstre pour un réglage (`play` en combat réel, `predict` dans les prévisions des joueurs). */
export function createMonsterBrain(cfg: AIConfig, setting: MonsterSetting = 'play'): MonsterBrain {
  return new MonsterBrain(cfg, setting)
}
