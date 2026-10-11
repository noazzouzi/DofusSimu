/**
 * Section « Reine » du visualiseur — routes de l'API du serveur de développement (web/plugins/reine.ts), sans HTTP :
 * nouveau combat (placement du 2026-10-09, bombe du 1er Crâ placée par la règle d'apparition), dangers, état modifié
 * (bombe qui suit le Crâ qui joue), meilleurs tours sûrs, replay d'un tour, erreurs 400 / 404 / 405. Ne dépend pas
 * du journal AnkaBot (data/fightlogs) : seulement de la carte 137101316.
 */
import { describe, expect, it } from 'vitest'
import { initialState } from '../src/replay/reducer'
import { parseReplay } from '../src/replay/validate'
import { reineRoute } from '../web/plugins/reine'
import type { Snapshot } from '../tools/reine-des-voleurs/planificateur/etat'
import type { CellDanger, WebPlan } from '../tools/reine-des-voleurs/planificateur/web'

const get = (route: string, q: Record<string, string> = {}) => reineRoute('GET', route, new URLSearchParams(q), undefined)
const post = (route: string, body: Record<string, unknown>) => reineRoute('POST', route, new URLSearchParams(), body)
type View = { snapshot: Snapshot; replay: unknown; danger: CellDanger[] }

describe('API de la section Reine', () => {
  it('nouveau combat : 4 Crâs, la Reine et sa vague, bombe du 1er Crâ à 2 cases au nord-est', async () => {
    const v = (await get('etat', { source: 'nouveau' })) as View
    const s = v.snapshot
    expect(s.mapId).toBe(137101316)
    expect(s.entities.filter(e => e.kind === 'cra')).toHaveLength(4)
    expect(s.entities.filter(e => e.kind === 'monster').map(e => e.monsterId)).toEqual([3726, 3746, 3747, 3748, 3748])
    const bomb = s.entities.find(e => e.kind === 'bomb')!
    expect(bomb.owner).toBe(s.active)
    expect(bomb.cell).toBe(327) // Crâ en 354 : 354 − 27
    const st = initialState(parseReplay(JSON.parse(JSON.stringify(v.replay))))
    expect(st.fighters).toHaveLength(s.entities.length)
    expect(v.danger.length).toBeGreaterThan(10)
    expect(v.danger.some(d => d.threats.length === 0 && !d.bombDeath)).toBe(true)
  })

  it('état modifié : la bombe du Crâ qui joue suit sa nouvelle case', async () => {
    const v = (await get('etat', { source: 'nouveau' })) as View
    const s = structuredClone(v.snapshot)
    s.entities.find(e => e.gameId === s.active)!.cell = 412
    const w = (await post('vue', { snapshot: s })) as View
    expect(w.snapshot.entities.filter(e => e.kind === 'bomb').map(e => e.cell)).toEqual([385]) // 412 − 27
  })

  it('meilleurs tours : au moins un tour sûr, et son replay se lit', async () => {
    const v = (await get('etat', { source: 'nouveau' })) as View
    const r = (await post('plan', { snapshot: v.snapshot, top: 2 })) as { plans: WebPlan[] }
    expect(r.plans.length).toBeGreaterThan(0)
    const p = r.plans[0]
    expect(p.safe).toBe(true)
    expect(p.total).toBeGreaterThan(0)
    expect(p.apUsed).toBeLessThanOrEqual(12)
    const replay = parseReplay(JSON.parse(JSON.stringify(await post('animation', { snapshot: v.snapshot, steps: p.steps, title: 'essai' }))))
    expect(replay.events.some(e => e.t === 'cast')).toBe(true)
    expect(replay.warnings ?? []).toEqual([])
  }, 30_000)

  it('erreurs : instantané invalide (400), route inconnue (404), mauvaise méthode (405)', async () => {
    await expect(post('plan', { snapshot: { entities: [] } })).rejects.toMatchObject({ status: 400 })
    await expect(get('inconnue')).rejects.toMatchObject({ status: 404 })
    await expect(get('plan')).rejects.toMatchObject({ status: 405 })
  })
})
