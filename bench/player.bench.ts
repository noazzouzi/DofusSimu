/**
 * Banc B4 de l'IA de groupe (docs/design/ai.md §14.1, §16.6) : millisecondes par tour de joueur (décision complète :
 * observation, commandant, recherche, déplacement de fin, rollouts) en `fast` (cible ≤ 3,5 ms, échec CI > 7 ms) et en
 * `standard` (cible ≤ 120 ms, échec CI > 240 ms), 1 cœur, vraies données (scènes aléatoires : 3 personnages THL contre
 * 4 monstres du Vortex sur des cartes réelles, moteur partagé, caches chauds). Chaque appel de `bench` décide UN tour
 * (sans l'exécuter) d'une scène du corpus, avec un contrôleur neuf (rôles affectés à la première observation).
 * Le nombre moyen de nœuds par tour est imprimé en fin de banc (le budget est en nœuds : le temps varie avec la
 * machine et le coût d'un nœud du socle WP1, pas les décisions).
 *
 *   npx vitest bench bench/player.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import { defaultAIConfig, type AIMode } from '../src/ai'
import { TeamController } from '../src/ai/team/controller'
import { engineFor, randomScene } from '../tests/ai-core-helpers'

const engine = engineFor()
const scenes = Array.from({ length: 12 }, (_, i) => randomScene(i + 1, { engine }))
const stats: Record<string, { n: number; nodes: number }> = {}
const notes: string[] = []

function turn(mode: AIMode, i: number): void {
  const sc = scenes[i % scenes.length]
  const tc = new TeamController(defaultAIConfig(mode, i + 1))
  const d = tc.decide(engine, sc.fight, sc.me)
  const st = (stats[mode] ??= { n: 0, nodes: 0 })
  st.n++
  st.nodes += d?.nodes ?? 0
}

// Préchauffage (JIT, caches de profils, d'accessibilité et de DPT).
for (let i = 0; i < scenes.length; i++) turn('fast', i)
for (const k of Object.keys(stats)) delete stats[k]

let iFast = 0
let iStd = 0
describe('B4 — tour de joueur', () => {
  bench('B4 fast (cible ≤ 3,5 ms)', () => {
    turn('fast', iFast++)
  }, { time: 3000, iterations: 24 })
  bench('B4 standard (cible ≤ 120 ms)', () => {
    turn('standard', iStd++)
  }, { time: 6000, iterations: 6 })
})

afterAll(() => {
  for (const [mode, st] of Object.entries(stats)) notes.push(`${mode} : ${(st.nodes / Math.max(1, st.n)).toFixed(0)} nœuds/tour en moyenne (${st.n} tours)`)
  console.info(`[B4] ${notes.join(' ; ')}`)
})
