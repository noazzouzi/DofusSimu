/**
 * REPRO d'un bug de fidélité du moteur (signalé par le réglage de l'IA, docs/tuning-log.md, tour 1) — NE PAS corriger
 * ici : src/engine appartient à l'équipe moteur.
 *
 * Sac Animé (Enutrof, sort 13328) : « Invoque un Sac Animé […] Le Sac Animé est détruit 3 tours après son
 * invocation. » Les effets du niveau sont : 181 (invocation, masque `a,A`), 765 (interception, 3 tours, masque `g`),
 * 141 (« tue la cible », délai 3, masque `C`). Le moteur applique le 141 différé au LANCEUR : 3 tours après avoir
 * invoqué son Sac, l'Enutrof meurt (événement `death` avec `killer` = lui-même, sans dégât), et ses invocations avec
 * lui. Dans les combats du Vortex (IA `fast`, 32 graines), ≈ 20 % des morts de personnages sont ce suicide.
 *
 * Attendu (description du sort) : le Sac Animé meurt, l'Enutrof survit. Le test est marqué `fails` (il documente le
 * bug sans casser la suite) : quand le moteur sera corrigé, retirer `.fails`.
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { cellAt, fight, monster, newEngine, player, turnOf } from './effects-summons-helpers'

const ENUTROF = 3
const SAC_ANIME = 13328

describe('REPRO moteur — Sac Animé (13328) tue son lanceur 3 tours après l’invocation', () => {
  it.fails('l’Enutrof survit, le Sac Animé est détruit après 3 tours', () => {
    const engine = newEngine()
    const enu = player({ name: 'Enu', breedId: ENUTROF, spellIds: [SAC_ANIME], cell: cellAt(10, 0), hp: 4000, stats: { summons: 3, initiative: 5000 } })
    const enemy = monster(3834, cellAt(20, 0), { grade: 1 })
    const fs = fight(engine, [enu, enemy])
    turnOf(engine, fs, enu)
    expect(castSpell(engine, fs, enu, SAC_ANIME, cellAt(11, 0)).ok).toBe(true)
    const sac = fs.fighters.find(f => f.kind === 'summon' && f.summonerId === enu.id)
    expect(sac).toBeDefined()
    // Quatre tours de l'Enutrof plus tard (le délai 3 est échu).
    for (let i = 0; i < 4 && !fs.ended; i++) turnOf(engine, fs, enu)
    expect(enu.alive).toBe(true)
    expect(sac!.alive).toBe(false)
  })
})
