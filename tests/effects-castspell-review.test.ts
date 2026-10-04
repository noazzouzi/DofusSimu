/**
 * Relecture adverse de la famille « lancements de sorts » (src/engine/effects/castspell.ts) : effets différés qui
 * lancent un sous-sort SUR LA CASE ciblée par le lancer d'origine (2794 / 2960 avec `delay`), avec des sorts réels.
 *
 * Pluie de Flèches (Cra 32431) : dommages Air en croix 3 sur la case ciblée, puis (o4, délai 1) le Cra lance 32481 sur
 * la MÊME case ciblée au début de son tour suivant (2794, masque C) — la pluie ne doit pas tomber autour du Cra.
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import type { FightEvent } from '../src/engine/types'
import { getEffectHandler } from '../src/engine/effects/registry'
import { NOOP_EFFECTS } from '../src/engine/effects/misc'
import { cellAt, fight, has, monster, newEngine, player, turnOf } from './effects-summons-helpers'

const CRA = 9

const damagesOn = (evs: FightEvent[], target: number) => evs.filter((e): e is Extract<FightEvent, { t: 'damage' }> => e.t === 'damage' && e.target === target)

describe('2794 différé — Pluie de Flèches (Cra 32431)', () => {
  it('au tour suivant, la pluie (32481) retombe sur la case ciblée au lancer, pas sur la case du Cra', () => {
    if (!has(98)) return
    const engine = newEngine()
    const cra = player({ name: 'Cra', breedId: CRA, spellIds: [32431], cell: cellAt(10, 0), stats: { agility: 500, initiative: 9000 } })
    // Cible : à 4 cases ; voisin : au contact du Cra mais hors de la croix 3 autour de la cible.
    const target = monster(3834, cellAt(14, 0), { grade: 1, initiative: 10 })
    const neighbour = monster(3834, cellAt(9, 0), { grade: 1, initiative: 5 })
    const fs = fight(engine, [cra, target, neighbour], { rollMode: 'average' })
    turnOf(engine, fs, cra)
    expect(castSpell(engine, fs, cra, 32431, target.cell).ok).toBe(true)
    // Effet différé posé sur le Cra (masque C) en mémorisant la case ciblée.
    const delayed = cra.buffs.find(b => b.kind === 'delayed' && b.effect.effectId === 2794)
    expect(delayed).toBeDefined()
    expect(delayed?.targetCell).toBe(target.cell)
    expect(damagesOn(fs.events, target.id).length).toBeGreaterThan(0)
    expect(damagesOn(fs.events, neighbour.id)).toHaveLength(0)
    const n = fs.events.length
    turnOf(engine, fs, target)
    turnOf(engine, fs, neighbour)
    turnOf(engine, fs, cra)
    const evs = fs.events.slice(n)
    // La pluie frappe la zone ciblée (la cible n'a pas bougé) et épargne le voisin du Cra.
    expect(damagesOn(evs, target.id).filter(d => d.source === cra.id && d.element === 4).length).toBe(1)
    expect(damagesOn(evs, neighbour.id)).toHaveLength(0)
  })
})

describe('effets neutres (src/engine/effects/misc.ts)', () => {
  it('challenges (2876 / 2877), mise en scène (2192) et vol de kamas (130) sont des no-op enregistrés', () => {
    for (const id of [2876, 2877, 2192, 130]) {
      expect(NOOP_EFFECTS).toContain(id)
      expect(getEffectHandler(id)?.family).toBe('noop')
    }
  })
})
