/**
 * Reine des Voleurs sous Brume (tools/reine-des-voleurs/planificateur/brume.ts) : ses cases possibles (le milieu de la
 * brume et les 3 cases du haut), ce qu'une Flèche Perforante sur le milieu en apprend, et le tour de recherche du
 * planificateur. Puis, si les journaux du 2026-10-10 sont là (non versionnés) : la croyance et le plan sur les Brumes
 * réelles.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSpellProfileIndex } from '../src/ai/core/spellProfile'
import { createEngine } from '../src/engine/index'
import { CELL_X, CELL_Y } from '../src/map/geometry'
import { PERFORANTE, brumeCells, learn } from '../tools/reine-des-voleurs/planificateur/brume'
import { data } from '../tools/reine-des-voleurs/planificateur/etat'
import { measure } from '../tools/reine-des-voleurs/planificateur/fidelite'
import { FORMATION_PLACEMENT_2, planFormationTurn, type FormationState, type PlayedTurn } from '../tools/reine-des-voleurs/planificateur/formation'

const MORNING = 'data/fightlogs/2026-10-10/session-08-29-54.jsonl'
const AFTERNOON = 'data/fightlogs/2026-10-10/session-13-10-13.jsonl'

const fp = createSpellProfileIndex(createEngine(data)).of(data.spell(PERFORANTE)!.levels.at(-1)!)
const free = () => false

describe('Reine sous Brume', () => {
  it('cases possibles : le milieu puis la ligne vers le haut (+y), 3 cases', () => {
    expect(brumeCells(204, () => true)).toEqual([204, 190, 177, 163])
  })

  it('Flèche Perforante sur le milieu, d’en dessous : plus haute case de la brume, ou hors de la brume', () => {
    const h = { center: 204, cells: [204, 190, 177, 163] }
    // Touchée et toujours invisible : elle était au milieu, poussée de 3 sur la plus haute case.
    expect(learn(h, fp, 298, 204, true, true, free).cells).toEqual([163])
    // Pas touchée : aucune des 4 cases (elle est ailleurs).
    expect(learn(h, fp, 298, 204, false, true, free).cells).toEqual([])
    // Une poussée bloquée la garde plus bas (case 177 occupée : arrêtée en 190).
    expect(learn(h, fp, 298, 204, true, true, c => c === 177).cells).toEqual([190])
  })
})

describe.skipIf(!existsSync(MORNING) || !existsSync(AFTERNOON))('Brumes réelles du 2026-10-10', () => {
  function hiddenTurns(file: string): [FormationState, PlayedTurn][] {
    const out: [FormationState, PlayedTurn][] = []
    measure(file, { fast: true, onCraTurn: (s, p) => s.hidden && out.push([s, p]) })
    for (const [s] of out) {
      for (const [name, cell] of Object.entries(FORMATION_PLACEMENT_2)) {
        const f = s.fight.fighters.find(x => x.name === name)
        if (f) s.anchors.set(s.gameIdOf.get(f.id)!, cell)
      }
    }
    return out
  }

  it('manche 4 du matin : Java cherche la Reine par Flèche Perforante sur 301, d’en dessous (comme au combat)', () => {
    const turns = hiddenTurns(MORNING)
    const java = turns.find(([, p]) => p.round === 4 && p.name === 'Java-Springboot')
    expect(java).toBeDefined()
    const [st] = java!
    expect(st.hidden).toMatchObject({ center: 301, cells: [301, 288, 274, 261] })
    const plan = planFormationTurn(st, { top: 1 }).plans[0]
    expect(plan.probe?.covered).toEqual([301, 288, 274, 261])
    const last = plan.steps.at(-1)!
    expect(last).toMatchObject({ kind: 'cast', spell: PERFORANTE, cell: 301 })
    // Tir d'en dessous : même x que le milieu, y plus petit.
    const from = plan.endCell
    expect(CELL_X[from]).toBe(CELL_X[301])
    expect(CELL_Y[from]).toBeLessThan(CELL_Y[301])
  }, 240_000)

  it('manche 10 de l’après-midi : les tirs sans dégâts sur le milieu (275) l’écartent', () => {
    const turns = hiddenTurns(AFTERNOON)
    const kemist = turns.find(([, p]) => p.round === 10 && p.name === 'Kemist-Skyler')
    expect(kemist?.[0].hidden?.cells).toEqual([262, 248, 235])
  }, 240_000)
})
