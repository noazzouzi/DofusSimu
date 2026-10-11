/**
 * Fidélité du moteur sur le combat réel du 2026-10-10 (tools/reine-des-voleurs/planificateur/fidelite.ts) : chaque tour
 * du journal AnkaBot rejoué action par action et comparé au réel. Seuils = niveau atteint le 2026-10-10, pour qu'une
 * régression du moteur, des règles du combat (regles.ts) ou de l'IA des monstres (monstres.ts) se voie. Sauté si le
 * journal (non versionné, 36 Mo) est absent.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { measure } from '../tools/reine-des-voleurs/planificateur/fidelite'

const FILE = 'data/fightlogs/2026-10-10/session-08-29-54.jsonl'
const rate = (t: { ok: number; total: number }) => t.ok / t.total

describe.skipIf(!existsSync(FILE))('fidélité du moteur (combat réel du 2026-10-10)', () => {
  it('déplacements, lancers, dégâts, bombes et IA des monstres au niveau mesuré', () => {
    const r = measure(FILE)
    expect(r.rounds).toBe(13)
    expect(rate(r.moves)).toBe(1)
    expect(rate(r.castsAccepted)).toBeGreaterThanOrEqual(0.99)
    expect(rate(r.damage)).toBeGreaterThanOrEqual(0.85)
    expect(rate(r.pushes)).toBeGreaterThanOrEqual(0.97)
    expect(rate(r.bombSpawn)).toBe(1)
    expect(rate(r.bombPhase)).toBe(1)
    expect(rate(r.nova)).toBe(1)
    expect(rate(r.monsterAi)).toBeGreaterThanOrEqual(0.55)
    // Total des dégâts des Crâs : le réel dans la fourchette des jets du moteur.
    expect(r.damage.real).toBeGreaterThanOrEqual(r.damage.low)
    expect(r.damage.real).toBeLessThanOrEqual(r.damage.high)
  }, 120_000)
})
