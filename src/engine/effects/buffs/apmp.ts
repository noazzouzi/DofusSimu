/**
 * PA / PM (kind `ap_mp` + retraits non esquivables 168/169 ; docs/research/effects.md §3, §7.3, mechanics.md §7) :
 *  - 1079 / 1080 : retrait ESQUIVABLE de PA / PM ; 84 / 77 : vol esquivable (le lanceur gagne les points retirés) ;
 *  - 168 / 169 : retrait NON esquivable (169 diceNum 100 = immobilisation) ; 440 / 441 : vol non esquivable (INCERTAIN) ;
 *  - 120 / 78 : « Rembourse X PA / PM » au lanceur, immédiatement, sans buff.
 *
 * Jet d'esquive (src/damage/apmp.ts, OTOMAI `RollApLose`) : pour chaque point,
 * p = clamp((restants − déjà retirés) / max × Retrait_lanceur / Esquive_cible / 2, 10 %, 90 %).
 * « restants » = PA/PM courants si la cible joue, sinon son total (les points sont rendus en fin de tour) ;
 * « max » = son total de PA/PM (stats, buffs compris). En mode 'average' : espérance exacte du nombre de points
 * retirés (non entière), moyennée sur le jet [diceNum, diceSide] du nombre de points tentés ; en 'min' / 'max' :
 * espérance pour le jet min / max (le retrait lui-même n'a pas de jet de dés).
 *
 * Les points retirés deviennent un débuff de `duration` tours (statDelta) qui réduit aussi les points courants si la
 * cible joue (Engine.applyPoolDelta). Déclencheurs : 'APA' / 'MPA' sur la cible seulement si des points ont
 * réellement été perdus (OTOMAI `HaxeBuff` : `ApStolen > 0` / `AmStolen > 0` — un retrait entièrement esquivé ne
 * déclenche rien), 'CAPA' / 'CMPA' (tentative, même esquivée) et 'CAPAS' / 'CMPAS' (réussite) sur le lanceur.
 * Métriques `apRemoved` / `mpRemoved` du lanceur.
 * Un état portant l'effet d'état 29 / 30 (InvulnerableToLostAp / Mp, mechanics.md §12) annule le retrait.
 */
import { apMpRemovalProbability, expectedApMpRemoved } from '../../../damage/apmp'
import { nextRandom } from '../../random'
import { addMetric } from '../../cow'
import type { Fighter } from '../../types'
import type { EffectContext } from '../registry'
import { addEffectBuff, enforceMaxStack, isPlaying, recording, registerBuffEffect, rollValue, signed } from './common'

type Pool = 'ap' | 'mp'

/** Effets d'état « insensible aux pertes de PA / PM » (StateEffectId 29 / 30). */
const STATE_EFFECT_IMMUNE_AP = 29
const STATE_EFFECT_IMMUNE_MP = 30

/** La cible porte-t-elle un état actif qui l'immunise contre les pertes de PA (ou PM) ? */
export function immuneToLoss(ctx: EffectContext, f: Fighter, pool: Pool): boolean {
  const code = pool === 'ap' ? STATE_EFFECT_IMMUNE_AP : STATE_EFFECT_IMMUNE_MP
  for (const s of f.states) {
    if (f.disabledStates?.includes(s)) continue
    const ids = ctx.engine.data.state(s)?.effectsIds
    if (ids && ids.includes(code)) return true
  }
  return false
}

/** Points « restants » de la cible : PA/PM courants si elle joue, sinon son total (rendu en fin de tour). */
function currentPoints(ctx: EffectContext, f: Fighter, pool: Pool): number {
  return isPlaying(ctx, f) ? Math.max(0, f[pool]) : Math.max(0, f.stats[pool])
}

/** Taille du tampon de l'espérance sans allocation (au-delà : calcul générique de src/damage). */
const DP_SIZE = 64
const dp = new Float64Array(DP_SIZE + 1)
const dpNext = new Float64Array(DP_SIZE + 1)

/** Espérance du nombre de points retirés (même distribution que `apMpRemovalDistribution`, sans allocation). */
function expectedRemoved(removal: number, dodge: number, current: number, max: number, attempted: number): number {
  const n = Math.floor(attempted)
  if (n <= 0 || current <= 0) return 0
  if (n > DP_SIZE) return expectedApMpRemoved(removal, dodge, current, max, n)
  dp.fill(0, 0, n + 1)
  dp[0] = 1
  for (let i = 0; i < n; i++) {
    dpNext.fill(0, 0, n + 1)
    for (let k = 0; k <= i; k++) {
      const pk = dp[k]
      if (pk === 0) continue
      const p = apMpRemovalProbability(removal, dodge, current, max, k)
      dpNext[k + 1] += pk * p
      dpNext[k] += pk * (1 - p)
    }
    for (let k = 0; k <= n; k++) dp[k] = dpNext[k]
  }
  let mean = 0
  for (let k = 1; k <= n; k++) mean += k * dp[k]
  return mean
}

/** Nombre de points retirés par un retrait esquivable (jet par point, ou espérance hors mode 'random'). */
export function rollDodgeableRemoval(ctx: EffectContext, caster: Fighter, target: Fighter, pool: Pool, attempted: number): number {
  const current = currentPoints(ctx, target, pool)
  if (current <= 0 || attempted <= 0) return 0
  const max = Math.max(target.stats[pool], current)
  const removal = pool === 'ap' ? caster.stats.apReduction : caster.stats.mpReduction
  const dodge = pool === 'ap' ? target.stats.apParry : target.stats.mpParry
  if (ctx.fight.options.rollMode !== 'random') return expectedRemoved(removal, dodge, current, max, attempted)
  let removed = 0
  for (let i = 0; i < attempted && removed < current; i++) {
    if (nextRandom(ctx.fight) < apMpRemovalProbability(removal, dodge, current, max, removed)) removed++
  }
  return removed
}

/** Pose le débuff de PA/PM (et le gain du lanceur pour un vol). */
function applyLoss(ctx: EffectContext, target: Fighter, pool: Pool, amount: number): void {
  enforceMaxStack(ctx, target)
  const label = recording(ctx) ? `${signed(-amount)} ${pool === 'ap' ? 'PA' : 'PM'}` : ''
  addEffectBuff(ctx, target, { value: -amount, statDelta: pool === 'ap' ? { ap: -amount } : { mp: -amount } }, label)
}

function applyGain(ctx: EffectContext, target: Fighter, pool: Pool, amount: number): void {
  enforceMaxStack(ctx, target)
  const label = recording(ctx) ? `${signed(amount)} ${pool === 'ap' ? 'PA' : 'PM'}` : ''
  addEffectBuff(ctx, target, { value: amount, statDelta: pool === 'ap' ? { ap: amount } : { mp: amount } }, label)
}

/**
 * Retrait (ou vol) de PA/PM sur chaque cible.
 * @param dodgeable retrait soumis au jet d'esquive (1079/1080/77/84) ; sinon montant fixe (168/169/440/441).
 * @param steal le lanceur gagne les points effectivement retirés (même durée).
 */
function removal(ctx: EffectContext, pool: Pool, dodgeable: boolean, steal: boolean): void {
  const { caster, fight, engine } = ctx
  const attemptCode = pool === 'ap' ? 'CAPA' : 'CMPA'
  const successCode = pool === 'ap' ? 'CAPAS' : 'CMPAS'
  const lossCode = pool === 'ap' ? 'APA' : 'MPA'
  const e = ctx.effect
  // Mode espérance avec un nombre de points tenté variable ([diceNum, diceSide]) : moyenne exacte sur chaque jet.
  const averageRange = dodgeable && fight.options.rollMode === 'average' && e.diceSide > e.diceNum
  for (const t of ctx.targets) {
    if (!t.alive) continue
    const attempted = rollValue(ctx)
    if (attempted <= 0) continue
    let removed = 0
    let effective = 0
    if (!immuneToLoss(ctx, t, pool)) {
      if (averageRange) {
        for (let a = e.diceNum; a <= e.diceSide; a++) removed += rollDodgeableRemoval(ctx, caster, t, pool, a)
        removed /= e.diceSide - e.diceNum + 1
        effective = removed
      } else if (dodgeable) {
        removed = rollDodgeableRemoval(ctx, caster, t, pool, attempted)
        effective = removed
      } else {
        // Non esquivable : le débuff vaut le montant (immobilisation 100 PM), l'effet réel est borné aux points restants.
        removed = attempted
        effective = Math.min(attempted, currentPoints(ctx, t, pool))
      }
    }
    if (removed > 0) {
      applyLoss(ctx, t, pool, removed)
      // Métriques : objet remplacé (partagé entre clones de combat, src/engine/cow.ts).
      addMetric(fight, caster.id, pool === 'ap' ? 'apRemoved' : 'mpRemoved', effective)
      if (steal && caster.alive && caster.id !== t.id && effective > 0) applyGain(ctx, caster, pool, effective)
    }
    if (fight.ended) return
    // En mode espérance, la réussite est décidée à ≥ 0,5 point retiré (déclencheurs non fractionnables).
    const success = fight.options.rollMode === 'random' ? effective > 0 : effective >= 0.5
    // Perte subie (APA / MPA) : seulement si des points ont été perdus (pas sur un retrait esquivé ou annulé).
    if (success && t.alive) engine.trigger(fight, t, { type: lossCode, source: caster, amount: effective })
    if (caster.alive) {
      engine.trigger(fight, caster, { type: attemptCode, source: caster, amount: effective })
      if (success && caster.alive) engine.trigger(fight, caster, { type: successCode, source: caster, amount: effective })
    }
  }
}

/** « Rembourse X PA / PM » : points rendus immédiatement pour le tour en cours (sans buff), ou buff si `duration`. */
function instantGain(ctx: EffectContext, pool: Pool): void {
  for (const t of ctx.targets) {
    if (!t.alive) continue
    const v = rollValue(ctx)
    if (!v) continue
    if (ctx.effect.duration !== 0) {
      applyGain(ctx, t, pool, v)
      continue
    }
    t[pool] += v
    ctx.engine.emit(ctx.fight, { t: 'apmp', target: t.id, ap: t.ap, mp: t.mp, reason: pool === 'ap' ? 'Rembourse PA' : 'Rembourse PM' })
  }
}

registerBuffEffect(1079, ctx => removal(ctx, 'ap', true, false))
registerBuffEffect(1080, ctx => removal(ctx, 'mp', true, false))
registerBuffEffect(84, ctx => removal(ctx, 'ap', true, true))
registerBuffEffect(77, ctx => removal(ctx, 'mp', true, true))
registerBuffEffect(168, ctx => removal(ctx, 'ap', false, false))
registerBuffEffect(169, ctx => removal(ctx, 'mp', false, false))
registerBuffEffect(440, ctx => removal(ctx, 'ap', false, true))
registerBuffEffect(441, ctx => removal(ctx, 'mp', false, true))
registerBuffEffect(120, ctx => instantGain(ctx, 'ap'))
registerBuffEffect(78, ctx => instantGain(ctx, 'mp'))
