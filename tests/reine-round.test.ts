/**
 * Round complet contre la Reine des Voleurs (tools/reine-des-voleurs/planificateur/round.ts) depuis le préréglage
 * « nouveau combat » (sans journal) : les Crâs passent leur tour, les monstres jouent (contrôleurs de monstres.ts),
 * une Bonbombe apparaît au début du tour de chaque Crâ, la Reine se déplace par Mort en Sursis sur ses alliés, et le
 * replay se lit dans le visualiseur.
 */
import { describe, expect, it } from 'vitest'
import { parseReplay } from '../src/replay/validate'
import { planRound } from '../tools/reine-des-voleurs/planificateur/equipe'
import { simulateRound } from '../tools/reine-des-voleurs/planificateur/round'
import { redCells } from '../tools/reine-des-voleurs/planificateur/placement'
import { newFightSnapshot, placementForWeb } from '../tools/reine-des-voleurs/planificateur/web'

describe('round simulé (Reine des Voleurs)', () => {
  it('une manche et demie sans action des Crâs : bombes, Reine, monstres de vague, replay valide', () => {
    const snap = newFightSnapshot()
    const res = simulateRound(snap, { turns: 12 })
    const replay = parseReplay(JSON.parse(JSON.stringify(res.replay)))
    expect(replay.warnings ?? []).toEqual([])
    // 1 bombe de Java (instantané) + 3 apparitions de la manche 1 (Lamouit, Lowkey, Kemist) + celle de Java en manche 2.
    const summons = replay.events.filter(e => e.t === 'summon')
    expect(summons.length).toBeGreaterThanOrEqual(4)
    // La Reine (2e manche) se déplace par Mort en Sursis sur ses alliés.
    const reine = res.turns.find(t => t.round === 2 && t.name.startsWith('Reine'))!
    expect(reine.actions.some(a => a.startsWith('Mort en Sursis'))).toBe(true)
    // Les monstres de vague avancent (aucun ne finit sur sa case de départ).
    for (const name of ['Mâchassin', 'Terristocrate']) {
      const t = res.turns.find(x => x.name.startsWith(name))!
      const start = snap.entities.find(e => e.name.startsWith(name))!.cell
      expect(t.endCell).not.toBe(start)
    }
  }, 30_000)

  it('meilleur round de l’équipe : un tour par Crâ, aucun Crâ mort, replay valide', () => {
    const res = planRound(newFightSnapshot(), { width: 2, perCra: 2 })
    expect(res.turns.map(t => t.name)).toHaveLength(4)
    // IA des monstres mesurée sur le combat réel du 2026-10-10 (monstres.ts : Fumérus, approche au plus près) : un Crâ
    // peut n'avoir aucune case hors de portée de tous les monstres ; les autres ont un tour sûr.
    expect(res.turns.filter(t => t.plan !== null).length).toBeGreaterThanOrEqual(3)
    expect(res.score.craDeaths).toEqual([])
    expect(res.score.monsterDamage).toBeGreaterThan(0)
    // Le déroulé va jusqu'au tour de la Reine de la manche suivante.
    expect(res.summaries.some(s => s.round === 2 && s.name.startsWith('Reine'))).toBe(true)
    const replay = parseReplay(JSON.parse(JSON.stringify(res.replay)))
    expect(replay.warnings ?? []).toEqual([])
  }, 120_000)

  it('placement optimisé : 4 cases rouges distinctes, aucun Crâ mort, placement chargeable', () => {
    const res = placementForWeb(newFightSnapshot(), { sets: 1, width: 2, perCra: 2 })
    const red = new Set(redCells())
    const cells = res.team.placement.map(p => p.cell)
    expect(new Set(cells).size).toBe(4)
    expect(cells.every(c => red.has(c))).toBe(true)
    expect(res.potentials.length).toBe(12)
    expect(res.team.score.craDeaths).toEqual([])
    // Instantané chargeable : Crâs sur les cases retenues, premier Crâ actif, bombe de sa manche posée.
    for (const p of res.team.placement) expect(res.snapshot.entities.find(e => e.gameId === p.gameId)?.cell).toBe(p.cell)
    expect(res.snapshot.entities.find(e => e.gameId === res.snapshot.active)?.kind).toBe('cra')
    expect(res.snapshot.entities.some(e => e.kind === 'bomb' && e.owner === res.snapshot.active)).toBe(true)
  }, 180_000)
})
