/**
 * Modèle analytique T0 d'une équipe contre l'Œil de Vortex (niveau L5, docs/design/ai.md §15.6 point 2) — WP4b.
 *
 * Capacités par preset (calculées une fois, `presetCapabilities`) : stuff du preset (ou stuff fourni, ex. sortie du
 * proxy L3), `ProxyContext` exact (src/ai/core `DptTable`) : DPT contre les monstres de vague (pondéré par la
 * composition des vagues à N joueurs) et contre le Vortex, dégâts reçus d'un monstre de vague moyen et du Vortex de
 * phase 2 (16 PA), EHP, PM/PA retirés par tour, soins par tour, initiative.
 *
 * Modèle d'une équipe (`t0Evaluate`, ≈ 5 µs) — simulation abstraite, déterministe, tour de jeu par tour de jeu :
 *  - phase 1 : vagues aux tours `arrivalRounds` (composition `waveComposition(N)`, Vortex exclu), chaque monstre doit
 *    être tué (PV) puis RE-tué ≥ 3 tours plus tard à 25 % de PV (corruption, « même tueur » : cycle d'horloge à N = 4) ;
 *    capacité de dégâts = efficacité (0,5 : portée, LdV, heures, déplacements) × Σ DPT des vivants (+30 % pour une zone si ≥ 2
 *    cibles) ; menace = monstres non corrompus × dégâts moyens × (1 − contrôle), contrôle = PM/PA retirés / PM/PA des
 *    monstres (plafonné à 60 %) ; soins (80 %) déduits ; poison des Harpilles sans soigneur : +10 % ; les dégâts
 *    nets se répartissent sur les vivants, morts quand ils dépassent l'EHP ; le Vortex se déverrouille au plus tôt au
 *    tour `unlockRound` (26), une fois tous les monstres corrompus ;
 *  - phase 2 : PV du Vortex × facteur d'heures héritées (1,25) ; burst = Σ DPT des vivants contre le Vortex ; à chaque
 *    tour du Vortex, il frappe le personnage le plus fragile (dégâts × (1 − contrôle)) ;
 *  - sortie : score prédit au format du score de combat (§15.2 : victoire 1 + 0,1·PV% − tours/600, sinon 0,8 ×
 *    progression 0,45 corrompus + 0,15 déverrouillé + 0,30 dégâts Vortex + 0,10 vivants), P(victoire) (sigmoïde
 *    rationnelle de la marge), puis contraintes de couverture (≥ 2 personnages capables de corrompre seuls un zombie,
 *    ≥ 1 contrôle ou placeur) et prior de synergies (`prior.ts`).
 * Le modèle est GROSSIER : il ne sert qu'à filtrer ≈ 2,7·10⁵ équipes vers quelques centaines avant le successive
 * halving sur vrais combats (`halving.ts`) ; son classement n'est jamais publié comme un taux de victoire.
 */
import type { RoleId } from '../../ai/types'
import type { Stats } from '../../core/types'
import type { GameDataStore } from '../../data/store'
import { VORTEX_TARGET_MIX } from '../../dungeons/generic/dummy'
import { ARRIVAL_ROUNDS_DEFAULT, VORTEX, VORTEX_HP_BY_GRADE, VORTEX_PHASE2_AP, waveComposition } from '../../dungeons/vortex/constants'
import { createMonsterFighter } from '../../engine/factory'
import { computeBuildStats, type CharacterBuild } from '../../stats/build'
import { createProxyContext } from '../stuff/proxy'
import { PRESETS, presetMember, type Preset } from './presets'
import { archetypeKey, teamPrior, type TeamPrior } from './prior'

export interface PresetCapability {
  presetId: string
  breedId: number
  className: string
  role: RoleId
  secondaryRole?: RoleId
  maxHp: number
  ehp: number
  /** DPT (calibré) moyen contre les monstres de vague, contre le Vortex. */
  dptWave: number
  dptVortex: number
  /** Dégâts reçus par tour d'un monstre de vague moyen ; du Vortex en phase 2. */
  incWave: number
  incVortex: number
  mpRemoved: number
  apRemoved: number
  heal: number
  initiative: number
  zone: boolean
  /** Logarithme du proxy de stuff (J), pour information. */
  logJ: number
}

export interface CapabilityOptions {
  /** Build d'un preset (défaut : stuff du preset). */
  build?: (p: Preset) => CharacterBuild
  grade?: number
  players?: number
}

/** Capacités des presets (voir l'en-tête), dans l'ordre de `presets`. */
export function presetCapabilities(data: GameDataStore, presets: readonly Preset[] = PRESETS, opts: CapabilityOptions = {}): PresetCapability[] {
  const players = opts.players ?? 4
  const waves = waveComposition(players).map(w => w.filter(id => id !== VORTEX))
  const counts = new Map<number, number>()
  for (const w of waves) for (const id of w) counts.set(id, (counts.get(id) ?? 0) + 1)
  return presets.map(p => {
    const m = presetMember(p, data)
    const build = opts.build?.(p) ?? m.build
    const r = computeBuildStats(build, data)
    const ctx = createProxyContext(data, { breedId: p.breedId, level: build.level, variants: p.variants, role: p.role, presetId: p.id, element: p.element }, r, { grade: opts.grade })
    const score = ctx.exact(r.stats, r.maxHp)
    let dw = 0
    let iw = 0
    let w = 0
    let dv = 0
    let iv = 0
    VORTEX_TARGET_MIX.forEach((t, i) => {
      if (t.monsterId === VORTEX) {
        dv = ctx.dptAgainst(r.stats, r.maxHp, i)
        iv = ctx.incomingFrom(r.stats, r.maxHp, i, VORTEX_PHASE2_AP)
        return
      }
      const n = counts.get(t.monsterId) ?? 0
      dw += n * ctx.dptAgainst(r.stats, r.maxHp, i)
      iw += n * ctx.incomingFrom(r.stats, r.maxHp, i)
      w += n
    })
    return {
      presetId: p.id,
      breedId: p.breedId,
      className: p.className,
      role: p.role,
      secondaryRole: p.secondaryRole,
      maxHp: r.maxHp,
      ehp: score.ehp,
      dptWave: w ? dw / w : 0,
      dptVortex: dv,
      incWave: w ? iw / w : 0,
      incVortex: iv,
      mpRemoved: ctx.removedPoints('mp', r.stats),
      apRemoved: ctx.removedPoints('ap', r.stats),
      heal: ctx.healPerTurn(r.stats),
      initiative: r.stats.initiative,
      zone: p.role === 'zoneDps' || p.secondaryRole === 'zoneDps',
      logJ: score.logJ,
    }
  })
}

// ───────────────────────────── modèle d'équipe ─────────────────────────────

export interface T0Params {
  players: number
  arrivalRounds: readonly number[]
  unlockRound: number
  maxRounds: number
  /** PV d'un monstre de vague (moyenne des grades du scénario) et du Vortex. */
  waveHp: number
  vortexHp: number
  /** Monstres par vague (hors Vortex). */
  waveSizes: readonly number[]
  rezPct: number
  efficiency: number
  zoneBonus: number
  controlCap: number
  healEff: number
  poisonExtra: number
  vortexHourFactor: number
  /** PM et PA moyens d'un monstre (contrôle). */
  monsterMp: number
  monsterAp: number
  /** Exposition subie par tour : part des monstres non corrompus qui frappent réellement (portée, ciblage). */
  exposure: number
}

/** Paramètres par défaut (Vortex à 4 joueurs, grade 5) depuis les données. */
export function defaultT0Params(data: GameDataStore, players = 4, grade = 5): T0Params {
  const waves = waveComposition(players).map(w => w.filter(id => id !== VORTEX))
  let hp = 0
  let mp = 0
  let ap = 0
  let n = 0
  for (const w of waves) {
    for (const id of w) {
      const f = createMonsterFighter(data, { monsterId: id, grade, team: 1 })
      hp += f.maxHp
      mp += f.stats.mp
      ap += f.stats.ap
      n++
    }
  }
  return {
    players,
    arrivalRounds: ARRIVAL_ROUNDS_DEFAULT,
    unlockRound: 26,
    maxRounds: 60,
    waveHp: n ? hp / n : 6000,
    vortexHp: VORTEX_HP_BY_GRADE[Math.max(1, Math.min(5, grade))],
    waveSizes: waves.map(w => w.length),
    rezPct: 0.25,
    efficiency: 0.5,
    zoneBonus: 0.3,
    controlCap: 0.6,
    healEff: 0.8,
    poisonExtra: 0.1,
    vortexHourFactor: 1.25,
    monsterMp: n ? mp / n : 5,
    monsterAp: n ? ap / n : 12,
    exposure: 1,
  }
}

export interface T0Result {
  presetIds: string[]
  /** Score prédit (format du score de combat, §15.2) et P(victoire) estimée. */
  predicted: number
  pWin: number
  /** Score de classement = prédit × couverture + prior. */
  score: number
  phase1: { corrupted: number; total: number; completedRound: number; deaths: number; wipedRound?: number }
  phase2: { reached: boolean; turnsToKill: number; vortexDamagePct: number; deaths: number; win: boolean }
  coverage: { killers: number; control: boolean; multiplier: number }
  prior: TeamPrior
  archetype: string
}

const CONTROL_ROLES: ReadonlySet<RoleId> = new Set<RoleId>(['mpLock', 'apLock', 'placer', 'support'])

/**
 * Part des PA consacrée au contrôle : 1 pour un rôle de contrôle (mpLock, apLock, placeur, soutien), 0,3 sinon (les
 * retraits d'un tueur se font au détriment de ses dégâts, comptés en entier dans `dptWave`).
 */
export function controlShare(c: Pick<PresetCapability, 'role' | 'secondaryRole'>): number {
  return CONTROL_ROLES.has(c.role) || (c.secondaryRole !== undefined && CONTROL_ROLES.has(c.secondaryRole)) ? 1 : 0.3
}

/** Part des PA consacrée aux soins : 1 pour un soigneur/soutien, 0,3 sinon. */
export function healShare(c: Pick<PresetCapability, 'role' | 'secondaryRole'>): number {
  return c.role === 'healer' || c.role === 'support' || c.secondaryRole === 'healer' ? 1 : 0.3
}

/** Sigmoïde rationnelle (sans exp) : 0,5·(1 + x/(1 + |x|)). */
function sig(x: number): number {
  return 0.5 * (1 + x / (1 + Math.abs(x)))
}

interface MonsterWork {
  hp: number
  killedAt: number
  done: boolean
}

/** Évalue une équipe (capacités des membres) avec le modèle T0 (voir l'en-tête). */
export function t0Evaluate(team: readonly PresetCapability[], p: T0Params, presets?: readonly Preset[]): T0Result {
  const n = team.length
  const dmgTaken = new Float64Array(n)
  const dead = new Uint8Array(n)
  const hasHealer = team.some(c => c.heal > 0 && (c.role === 'healer' || c.secondaryRole === 'healer' || c.heal >= 600))
  const monsters: MonsterWork[] = []
  let corrupted = 0
  const total = p.waveSizes.reduce((a, b) => a + b, 0)
  let wipedRound: number | undefined
  let completed = 0
  const alive = () => {
    let k = 0
    for (let i = 0; i < n; i++) if (!dead[i]) k++
    return k
  }
  const applyDamage = (net: number) => {
    // Dégâts répartis sur les vivants au prorata de leur EHP restant inverse (les monstres visent les fragiles).
    let k = alive()
    if (!k || net <= 0) return
    let left = net
    for (let guard = 0; guard < n && left > 1e-9 && k > 0; guard++) {
      const share = left / k
      left = 0
      for (let i = 0; i < n; i++) {
        if (dead[i]) continue
        dmgTaken[i] += share
        if (dmgTaken[i] >= team[i].ehp) {
          left += dmgTaken[i] - team[i].ehp
          dead[i] = 1
        }
      }
      k = alive()
    }
  }
  let round = 1
  for (; round <= p.maxRounds; round++) {
    const wi = p.arrivalRounds.indexOf(round)
    if (wi >= 0 && wi < p.waveSizes.length) for (let k = 0; k < p.waveSizes[wi]; k++) monsters.push({ hp: p.waveHp, killedAt: 0, done: false })
    const nAlive = alive()
    if (!nAlive) {
      wipedRound = round
      break
    }
    let activeCount = 0
    for (const m of monsters) if (!m.done) activeCount++
    if (!activeCount && round >= p.unlockRound && corrupted >= total) {
      completed = round
      break
    }
    // Dégâts de l'équipe.
    let cap = 0
    for (let i = 0; i < n; i++) {
      if (dead[i]) continue
      const c = team[i]
      cap += c.dptWave * (c.zone && activeCount >= 2 ? 1 + p.zoneBonus : 1)
    }
    cap *= p.efficiency
    for (const m of monsters) {
      if (cap <= 0) break
      if (m.done) continue
      if (m.killedAt === 0) {
        const d = Math.min(cap, m.hp)
        m.hp -= d
        cap -= d
        if (m.hp <= 1e-9) {
          m.killedAt = round
          m.hp = p.rezPct * p.waveHp
        }
      } else if (round >= m.killedAt + 3) {
        const d = Math.min(cap, m.hp)
        m.hp -= d
        cap -= d
        if (m.hp <= 1e-9) {
          m.done = true
          corrupted++
        }
      }
    }
    // Menace des monstres non corrompus.
    let threats = 0
    for (const m of monsters) if (!m.done) threats++
    if (threats > 0) {
      let mpR = 0
      let apR = 0
      let inc = 0
      let heal = 0
      for (let i = 0; i < n; i++) {
        if (dead[i]) continue
        const k = controlShare(team[i])
        mpR += k * team[i].mpRemoved
        apR += k * team[i].apRemoved
        inc += team[i].incWave
        heal += healShare(team[i]) * team[i].heal
      }
      const control = Math.min(p.controlCap, (mpR / (threats * p.monsterMp)) * 0.8 + (apR / (threats * p.monsterAp)) * 0.5)
      const perMonster = inc / Math.max(1, alive())
      let net = threats * p.exposure * perMonster * (1 - control) * (hasHealer ? 1 : 1 + p.poisonExtra) - p.healEff * heal
      if (net < 0) net = 0
      applyDamage(net)
    }
  }
  const phase1Deaths = Array.from(dead).filter(Boolean).length
  // Phase 2.
  let vortexHp = p.vortexHp * p.vortexHourFactor
  const maxVortex = vortexHp
  let turns = 0
  let p2deaths = 0
  let win = false
  const reached = completed > 0 && wipedRound === undefined
  if (reached) {
    for (turns = 1; turns <= Math.max(1, p.maxRounds - completed); turns++) {
      let burst = 0
      for (let i = 0; i < n; i++) if (!dead[i]) burst += team[i].dptVortex
      vortexHp -= burst
      if (vortexHp <= 0) {
        win = true
        break
      }
      // Le Vortex frappe le plus fragile (dégâts réduits par le retrait de PM/PA).
      let mpR = 0
      for (let i = 0; i < n; i++) if (!dead[i]) mpR += controlShare(team[i]) * team[i].mpRemoved
      const control = Math.min(0.5, mpR / 10)
      let target = -1
      let ratio = Infinity
      for (let i = 0; i < n; i++) {
        if (dead[i]) continue
        const left = team[i].ehp - dmgTaken[i]
        const r = left / Math.max(1, team[i].incVortex)
        if (r < ratio) {
          ratio = r
          target = i
        }
      }
      if (target < 0) break
      dmgTaken[target] += team[target].incVortex * (1 - control)
      if (dmgTaken[target] >= team[target].ehp) {
        dead[target] = 1
        p2deaths++
      }
      if (!alive()) break
    }
  }
  const nAlive = alive()
  const hpLeft = nAlive ? team.reduce((a, c, i) => a + (dead[i] ? 0 : Math.max(0, 1 - dmgTaken[i] / c.ehp) * c.maxHp), 0) / team.reduce((a, c) => a + c.maxHp, 0) : 0
  const totalRounds = (completed || p.maxRounds) + turns
  const vortexDamagePct = reached ? Math.min(1, (maxVortex - Math.max(0, vortexHp)) / maxVortex) : 0
  const progress = 0.45 * (corrupted / Math.max(1, total)) + 0.15 * (reached ? 1 : 0) + 0.3 * vortexDamagePct + 0.1 * (nAlive / Math.max(1, n))
  const predicted = win ? 1 + 0.1 * hpLeft - totalRounds / 600 : 0.8 * progress
  // Marge : victoire ⇒ PV restants ; défaite ⇒ distance à la victoire.
  const margin = win ? 1 + 2 * hpLeft : 4 * (progress - 1)
  const pWin = sig(margin)

  const killers = team.filter(c => c.dptWave >= p.rezPct * p.waveHp * 1.2).length
  const control = team.some(c => ['mpLock', 'apLock', 'placer'].includes(c.role) || ['mpLock', 'apLock', 'placer'].includes(c.secondaryRole ?? '') || c.mpRemoved >= 2)
  const multiplier = (killers >= 2 ? 1 : 0.85) * (control ? 1 : 0.9)
  const prior = teamPrior((presets ?? team.map(c => ({ id: c.presetId, breedId: c.breedId, role: c.role, secondaryRole: c.secondaryRole }) as unknown as Preset)))
  const score = predicted * multiplier + 0.05 * prior.score
  return {
    presetIds: team.map(c => c.presetId),
    predicted,
    pWin,
    score,
    phase1: { corrupted, total, completedRound: completed, deaths: phase1Deaths, wipedRound },
    phase2: { reached, turnsToKill: win ? turns : 0, vortexDamagePct, deaths: p2deaths, win },
    coverage: { killers, control, multiplier },
    prior,
    archetype: archetypeKey(prior.archetype),
  }
}

// ───────────────────────────── énumération ─────────────────────────────

/** Multiensembles de `size` presets (indices croissants, répétition permise), au plus `maxSameClass` par classe. */
export function* teamIndexSets(presets: readonly Pick<Preset, 'breedId'>[], size = 4, maxSameClass = 2, maxSamePreset = 1): Generator<number[]> {
  const idx = new Array<number>(size).fill(0)
  const rec = function* (pos: number, from: number): Generator<number[]> {
    if (pos === size) {
      yield idx.slice()
      return
    }
    for (let i = from; i < presets.length; i++) {
      let sameClass = 0
      let samePreset = 0
      for (let k = 0; k < pos; k++) {
        if (presets[idx[k]].breedId === presets[i].breedId) sameClass++
        if (idx[k] === i) samePreset++
      }
      if (sameClass >= maxSameClass || samePreset >= maxSamePreset) continue
      idx[pos] = i
      yield* rec(pos + 1, i)
    }
  }
  yield* rec(0, 0)
}

export interface T0RankOptions {
  presets?: readonly Preset[]
  capabilities?: readonly PresetCapability[]
  params?: Partial<T0Params>
  top?: number
  size?: number
  maxSameClass?: number
  /** Même preset au plus k fois (défaut 1 : deux personnages d'une classe = deux presets distincts). */
  maxSamePreset?: number
  /** Filtre facultatif (ex. classes imposées). */
  filter?: (presets: readonly Preset[]) => boolean
}

export interface T0Ranking {
  top: T0Result[]
  evaluated: number
  ms: number
  capabilities: PresetCapability[]
}

/** Classe toutes les équipes avec T0 et garde les `top` meilleures (score décroissant, départage par ids). */
export function t0Rank(data: GameDataStore, opts: T0RankOptions = {}): T0Ranking {
  const t0 = performance.now()
  const presets = opts.presets ?? PRESETS
  const caps = opts.capabilities ? opts.capabilities.slice() : presetCapabilities(data, presets)
  const params = { ...defaultT0Params(data, opts.size ?? 4), ...opts.params }
  const top = opts.top ?? 400
  const scores: { s: number; idx: number[] }[] = []
  let evaluated = 0
  let worst = -Infinity
  for (const idx of teamIndexSets(presets, opts.size ?? 4, opts.maxSameClass ?? 2, opts.maxSamePreset ?? 1)) {
    const ps = idx.map(i => presets[i])
    if (opts.filter && !opts.filter(ps)) continue
    const r = t0Evaluate(idx.map(i => caps[i]), params, ps)
    evaluated++
    if (scores.length >= top * 2 && r.score <= worst) continue
    scores.push({ s: r.score, idx })
    if (scores.length >= top * 4) {
      scores.sort((a, b) => b.s - a.s || cmpIdx(a.idx, b.idx))
      scores.length = top * 2
      worst = scores[scores.length - 1].s
    }
  }
  scores.sort((a, b) => b.s - a.s || cmpIdx(a.idx, b.idx))
  const best = scores.slice(0, top).map(x => t0Evaluate(x.idx.map(i => caps[i]), params, x.idx.map(i => presets[i])))
  return { top: best, evaluated, ms: performance.now() - t0, capabilities: caps }
}

function cmpIdx(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** Statistiques utiles d'un build (rapports). */
export function capabilityStats(c: PresetCapability): Pick<Stats, never> & Record<string, number> {
  return { dptWave: c.dptWave, dptVortex: c.dptVortex, ehp: c.ehp, mpRemoved: c.mpRemoved, heal: c.heal }
}
