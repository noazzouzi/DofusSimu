/**
 * Bancs B1 / B2 du socle IA (docs/design/ai.md §14.1, §16.6), 1 cœur, vraies données (scènes aléatoires : 3
 * personnages THL contre 4 monstres du Vortex sur des cartes réelles). Chaque appel de `bench` traite UN élément du
 * corpus : ops/s ⇒ µs par opération (1e6 / hz).
 *
 *  - B1 « nœud » : `simClone` + `applyMacro` (chemin + lancer, effets réels) — cible ≤ 70 µs, échec CI > 140 µs.
 *  - B2 « V(s) » : `valueOf` (menace + potentiel + DPT, perception synchronisée) d'un enfant (copie faite hors mesure) :
 *    (a) même géométrie déjà vue (cas courant d'un faisceau), (b) premier passage (géométrie nouvelle : accessibilités
 *    et lignes de vue recalculées) — cible ≤ 30 µs, échec CI > 60 µs.
 *  - Références : `cloneFight` seul, génération des candidats d'un nœud (`generateCasts` + `quickEstimate`), préfiltre
 *    par candidat, `computeReach` (6 PM, cible ≤ 5 µs).
 *
 *   npx vitest bench bench/core.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import {
  applyMacro, computeReach, createPerception, createView, generateCasts, quickEstimate, simClone, valueOf,
} from '../src/ai/core'
import type { MacroAction } from '../src/ai/types'
import type { FightState } from '../src/engine/types'
import { engineFor, randomScene } from '../tests/ai-core-helpers'

const engine = engineFor()
interface Scene {
  fight: FightState
  me: ReturnType<typeof randomScene>['me']
  view: ReturnType<typeof createView>
  p: ReturnType<typeof createPerception>
  cands: MacroAction[]
  kids: FightState[]
}
const scenes: Scene[] = []
for (let seed = 1; seed <= 16; seed++) {
  const { fight, me } = randomScene(seed, { engine })
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  valueOf(view, fight, p)
  const cands = generateCasts(view, fight, me, { perception: p })
  const kids: FightState[] = []
  for (const m of cands) {
    const c = simClone(view, fight, 7)
    if (applyMacro(engine, c, me.id, m)) kids.push(c)
  }
  scenes.push({ fight, me, view, p, cands, kids })
}
// Préchauffage : géométries des enfants en cache (B2a).
for (const sc of scenes) for (const k of sc.kids) valueOf(sc.view, k, sc.p, { root: sc.fight })

const nodes = scenes.flatMap(sc => sc.cands.map(m => ({ sc, m })))
const kids = scenes.flatMap(sc => sc.kids.map(k => ({ sc, k })))
let iNode = 0
let iKid = 0
let iFresh = 0
let iScene = 0
let iCand = 0
const notes: string[] = [`corpus : ${scenes.length} scènes, ${nodes.length} candidats, ${kids.length} enfants`]

describe('B1 — nœud (clone + chemin + lancer)', () => {
  bench('B1 simClone + applyMacro', () => {
    const { sc, m } = nodes[iNode++ % nodes.length]
    const c = simClone(sc.view, sc.fight, 7)
    applyMacro(engine, c, sc.me.id, m)
  })
  bench('réf. cloneFight seul', () => {
    const { sc } = nodes[iNode++ % nodes.length]
    engine.cloneFight(sc.fight, false)
  })
})

// Copies des enfants faites hors mesure : chaque appel voit un objet d'état différent du précédent (resynchronisation
// complète de la perception), sans compter le coût du clonage dans B2.
const kidCopies = kids.map(({ k }) => engine.cloneFight(k, false))

describe('B2 — V(s) d’un enfant', () => {
  bench('B2a valueOf (géométrie déjà vue)', () => {
    const i = iKid++ % kids.length
    valueOf(kids[i].sc.view, kidCopies[i], kids[i].sc.p, { root: kids[i].sc.fight })
  })
  bench('B2a\' valueOf + cloneFight (référence de la livraison)', () => {
    const { sc, k } = kids[iKid++ % kids.length]
    valueOf(sc.view, engine.cloneFight(k, false), sc.p, { root: sc.fight })
  })
  bench('B2b valueOf (premier passage : perception neuve)', () => {
    const { sc, k } = kids[iFresh++ % kids.length]
    const view = createView(engine, sc.fight, sc.me, 99)
    const p = createPerception(view)
    valueOf(view, k, p, { root: sc.fight })
  }, { time: 300 })
})

describe('génération et préfiltre', () => {
  bench('generateCasts + quickEstimate (un nœud)', () => {
    const sc = scenes[iScene++ % scenes.length]
    generateCasts(sc.view, sc.fight, sc.me, { perception: sc.p })
  })
  bench('quickEstimate (un candidat)', () => {
    const { sc, m } = nodes[iCand++ % nodes.length]
    quickEstimate(sc.view, sc.fight, sc.me, m, sc.p)
  })
  bench('computeReach (PM courants, ≈ 6)', () => {
    const sc = scenes[iScene++ % scenes.length]
    computeReach(sc.view, sc.fight, sc.me)
  })
})

afterAll(() => {
  console.log(`\n${notes.join('\n')}`)
})
