/**
 * Exécution d'un plan et replanification (docs/design/ai.md §8.7) — WP2.
 *
 * L'exécuteur joue le plan action par action dans le combat RÉEL (`performAction`, jets tirés) et compare l'état réel à
 * l'empreinte prévue (`StepDigest`) après chaque macro-action. Il replanifie (nouvelle recherche depuis l'état réel,
 * budget `replanFraction` × budget initial, ≤ `maxReplans` fois par tour) si : une action échoue ; la case, les PA ou
 * les PM du joueur diffèrent (esquive, tacle, poussée) ; un combattant apparaît, disparaît, meurt ou survit contre la
 * prévision ; l'écart de PV d'une cible dépasse θ.tactical.replanHpDev (15 %) des dégâts prévus ; l'heure a changé.
 * En `fast`, la recherche est relancée après CHAQUE action tant que le budget du tour le permet (le plan ne sert que
 * pour sa première action), sinon le plan courant est poursuivi. Garde : ≤ 12 actions moteur par tour.
 * L'équivalent joueur des règles R10/R11/R18 des monstres.
 */
import type { Engine } from '../../engine/engine'
import { performAction } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import { toActions, type AIMode } from '../types'
import { hourOf } from './evaluate'
import type { SearchPlan, StepDigest } from './node'

export interface ExecOptions {
  mode: AIMode
  /** Nouvelle recherche depuis l'état réel ; null si aucun budget ne reste (le plan courant est poursuivi). */
  replan: (reason: string) => SearchPlan | null
  maxReplans: number
  /** Écart relatif de PV toléré (θ.tactical.replanHpDev). */
  hpDev: number
  /** Actions moteur maximales par tour. */
  maxActions?: number
  /** Appelé après chaque nouveau plan (notes du replay). */
  onPlan?: (plan: SearchPlan, reason: string) => void
}

export interface ExecResult {
  actions: number
  replans: number
  plans: SearchPlan[]
  deviations: string[]
}

/** Écart entre l'état réel et l'empreinte prévue ; '' si conforme. */
export function deviation(fight: FightState, me: Fighter, d: StepDigest | undefined, hpDev: number): string {
  if (!d) return ''
  if (me.cell !== d.meCell) return 'case'
  if (Math.abs(me.ap - d.meAp) > 0.5) return 'PA'
  if (Math.abs(me.mp - d.meMp) > 0.5) return 'PM'
  if (fight.fighters.length !== d.fighters) return 'apparition'
  let n = 0
  for (const f of fight.fighters) if (f.alive) n++
  if (n !== d.alive.length) return 'mort'
  for (const id of d.alive) if (!fight.fighters[id]?.alive) return 'mort'
  for (const [id, pred, before] of d.hp) {
    const f = fight.fighters[id]
    if (!f) continue
    const real = f.alive ? f.hp + f.shield : 0
    const planned = Math.abs(before - pred)
    if (Math.abs(real - pred) >= 1 && Math.abs(real - pred) > hpDev * Math.max(1, planned)) return 'PV'
  }
  if (d.symbol >= 0 && hourOf(fight) !== d.symbol) return 'heure'
  return ''
}

/** Joue `plan` pour `me` dans le combat réel (voir l'en-tête). */
export function executePlan(engine: Engine, fight: FightState, me: Fighter, plan: SearchPlan, o: ExecOptions): ExecResult {
  const maxActions = o.maxActions ?? 12
  const res: ExecResult = { actions: 0, replans: 0, plans: [plan], deviations: [] }
  let cur = plan
  let i = 0
  while (i < cur.actions.length && res.actions < maxActions && me.alive && !fight.ended) {
    const m = cur.actions[i]
    let failed = false
    for (const a of toActions(m)) {
      if (res.actions >= maxActions || !me.alive || fight.ended) break
      const r = performAction(engine, fight, me, a)
      res.actions++
      if (!r.ok) {
        failed = true
        break
      }
    }
    const d = cur.digests[i]
    i++
    if (fight.ended || !me.alive) break
    const dev = failed ? 'échec' : deviation(fight, me, d, o.hpDev)
    if (dev) res.deviations.push(dev)
    const more = i < cur.actions.length
    const want = dev !== '' || (o.mode === 'fast' && more)
    if (want && res.replans < o.maxReplans) {
      const np = o.replan(dev || 'fast')
      if (np) {
        res.replans++
        res.plans.push(np)
        o.onPlan?.(np, dev || 'fast')
        cur = np
        i = 0
        continue
      }
    }
    if (failed) break
  }
  return res
}
