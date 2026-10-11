/**
 * Planificateur « formation en colonne » (tools/reine-des-voleurs/planificateur/formation.ts) : chaque Crâ sort tirer
 * puis revient sur sa case de la colonne. Préréglage « nouveau combat » (sans journal), puis, si le journal du combat
 * réel du 2026-10-10 est là (non versionné), les 8 tours des manches 1 et 2 : le plan note au moins autant que le tour joué
 * (7 sur 8 au moins) et finit sur la case de la colonne.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { measure } from '../tools/reine-des-voleurs/planificateur/fidelite'
import { FORMATION_PLACEMENT_2, formationStateFromSnapshot, planFormationTurn } from '../tools/reine-des-voleurs/planificateur/formation'
import { newFightSnapshot } from '../tools/reine-des-voleurs/planificateur/web'

const FILE = 'data/fightlogs/2026-10-10/session-08-29-54.jsonl'

describe('planificateur de formation (Reine des Voleurs)', () => {
  it('nouveau combat : le Crâ actif finit sur sa case, aucun Crâ tué par les bombes, des dégâts', () => {
    const snap = newFightSnapshot()
    const st = formationStateFromSnapshot(snap)
    const start = st.fight.fighters[st.active].cell
    const res = planFormationTurn(st, { top: 3 })
    expect(res.plans.length).toBeGreaterThan(0)
    const best = res.plans[0]
    expect(best.atAnchor).toBe(true)
    expect(best.endCell).toBe(start)
    expect(best.craDeaths.filter(d => d.atEnd)).toEqual([])
    expect([...best.damage.values()].reduce((a, x) => a + x, 0)).toBeGreaterThan(0)
    // Les pas se lisent : un déplacement est un chemin de cases voisines, un lancer a un sort et une case.
    for (const x of best.steps) {
      if (x.kind === 'move') expect(x.path.length).toBeGreaterThan(1)
      else expect(x.spell).toBeGreaterThan(0)
    }
  }, 60_000)

  it.skipIf(!existsSync(FILE))('combat réel : manches 1 et 2, plans sur la colonne et au moins aussi bons que les tours joués', () => {
    const out: { name: string; plan: number; played: number; atAnchor: boolean }[] = []
    measure(FILE, {
      onCraTurn: (state, played) => {
        if (played.round > 2) return
        for (const [name, cell] of Object.entries(FORMATION_PLACEMENT_2)) {
          const f = state.fight.fighters.find(x => x.name === name)
          if (f) state.anchors.set(state.gameIdOf.get(f.id)!, cell)
        }
        const plan = planFormationTurn(state).plans[0]
        const real = planFormationTurn(state, { replay: played.steps }).plans[0]
        out.push({ name: `${played.round} ${played.name}`, plan: plan.score, played: real.score, atAnchor: plan.atAnchor })
      },
    })
    expect(out).toHaveLength(8)
    for (const x of out) expect(x.atAnchor).toBe(true)
    // Faisceau : 7 tours sur 8 au moins aussi bons que le tour joué (Kemist manche 1 : quatre tirs de zone sur une case
    // vide, −10 %), et au total nettement mieux.
    expect(out.filter(x => x.plan >= x.played - 1).length).toBeGreaterThanOrEqual(7)
    expect(out.reduce((a, x) => a + x.plan, 0)).toBeGreaterThan(out.reduce((a, x) => a + x.played, 0))
  }, 180_000)
})
