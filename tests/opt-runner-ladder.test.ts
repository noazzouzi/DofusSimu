/**
 * WP4a — échelle des modes (docs/design/ai.md §16.5) : `random` < `scripted` < `fast`, comparaisons APPARIÉES sur les
 * mêmes graines (CRN) d'un combat de contrôle réel (4 monstres de vague du Vortex, grade 5, vraie salle).
 *
 * Tolérant aux bouchons : tant que l'IA `fast` (WP2) n'est pas livrée (aucun nœud simulé), seul le bon fonctionnement
 * est vérifié ; dès qu'elle simule (`nodes > 0`), `fast` doit faire au moins aussi bien que `scripted` (marge
 * statistique). La référence `random` doit déjà être nettement sous `scripted`.
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { compareConfigs } from '../src/optimizer/montecarlo'
import { createLocalPool } from '../src/optimizer/pool/pool'
import { campaignSeeds } from '../src/optimizer/seeds'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const CONTROL = 'control:143393281:3834,3836,3837,3838'
const TEAM = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
const base: FightSpec = { scenarioId: CONTROL, team: TEAM, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
const SEEDS = campaignSeeds(2026, 16)

describe('échelle des modes (appariée, CRN)', () => {
  it('random < scripted', async () => {
    const cmp = await compareConfigs({ ...base, playerPolicy: 'random' }, base, SEEDS, createLocalPool(DATA), { minN: 16, maxN: 16, halfWidth: 0 })
    expect(cmp.n).toBe(16)
    expect(cmp.b.result.winRate).toBeGreaterThan(cmp.a.result.winRate)
    expect(cmp.paired.scoreDiff).toBeGreaterThan(2 * cmp.paired.scoreSe)
  }, 120_000)

  it('scripted ≤ fast (vérifié seulement quand l\'IA fast simule : tolérant aux bouchons)', async () => {
    const cmp = await compareConfigs(base, { ...base, mode: 'fast' }, SEEDS, createLocalPool(DATA), { minN: 16, maxN: 16, halfWidth: 0 })
    const fastIsReal = cmp.b.summaries.some(s => s.nodes > 0)
    for (const s of [...cmp.a.summaries, ...cmp.b.summaries]) {
      expect(Number.isFinite(s.score)).toBe(true)
      expect(s.rounds).toBeGreaterThan(0)
    }
    expect(cmp.a.summaries.every(s => s.nodes === 0)).toBe(true) // scripted : 0 nœud
    if (fastIsReal) {
      // fast ne doit pas être significativement pire que scripted (différence ≥ −2 erreurs types, §16.5).
      expect(cmp.paired.scoreDiff).toBeGreaterThan(-2 * cmp.paired.scoreSe - 1e-9)
    } else {
      console.info(`[échelle] IA fast encore bouchonnée : scripted ${cmp.a.result.winRate} / fast ${cmp.b.result.winRate} (non comparé)`)
    }
  }, 300_000)
})
