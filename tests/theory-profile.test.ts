import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { listBosses } from '../src/theorycraft/bosses'
import { bossProfile, DEFAULT_REF_HP } from '../src/theorycraft/bossProfile'
import { nodeDungeonSource } from '../src/theorycraft/node'
import type { BossOverrides } from '../src/theorycraft/types'

const data = loadDataStore()
const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0)

describe('statistiques et grade', () => {
  it('Vortex, 4 joueurs ⇒ grade 1 : 15 000 PV, résistances 6/33/12/21/28', () => {
    const p = bossProfile(data, 3835)
    expect(p).toMatchObject({ grade: 1, players: 4, hp: 15000, level: 220, ap: 16 })
    expect(p.rawResPct).toEqual([6, 33, 12, 21, 28])
    expect(p.resPct).toEqual([6, 33, 12, 21, 28])
    expect(p.weakestElements).toEqual([0, 2, 3, 4, 1])
    expect(p.mpParry).toBe(100) // 20 + Sagesse 800 / 10
    expect(p.startingSpell?.spellId).toBe(5006)
    expect(p.assumptions[0]).toMatch(/Grade 1 pour 4 joueur/)
  })

  it('grade imposé ou déduit du nombre de joueurs ; grade absent ⇒ erreur', () => {
    expect(bossProfile(data, 3835, { players: 8 }).hp).toBe(22000)
    const g5 = bossProfile(data, 3835, { grade: 5, players: 4 })
    expect(g5.grade).toBe(5)
    expect(g5.players).toBeUndefined()
    expect(() => bossProfile(data, 3835, { grade: 7 })).toThrow(/pas de grade 7/)
    expect(() => bossProfile(data, 99999999)).toThrow(/Monstre inconnu/)
  })
})

describe('sort de départ', () => {
  it('Merkator : −50 % de dommages subis à distance (1163 ×50 sur DR) ⇒ 50 % de résistance distance', () => {
    const p = bossProfile(data, 3534)
    expect(p.stats.rangedResPct).toBe(50)
    expect(p.stats.meleeResPct).toBe(0)
    const m = p.mechanics.find(x => x.kind === 'reduced-range')!
    expect(m).toMatchObject({ source: 'data', spellId: 4009, counters: ['melee'] })
    expect(p.mechanics.some(x => x.kind === 'punished-removal')).toBe(true) // Mer Veille (déclencheur MPA)
    expect(p.mechanics.some(x => x.kind === 'cant-be-moved' && x.stateId === 97)).toBe(true)
  })

  it('Père Ver : invulnérable à distance dès le début (état 375) ⇒ phases vulnérables en mêlée', () => {
    const p = bossProfile(data, 4726)
    expect(p.mechanics.find(x => x.kind === 'invulnerable-range')).toMatchObject({ stateId: 375, counters: ['melee'] })
    expect(p.phases.every(ph => ph.vulnerable === 'melee')).toBe(true)
  })

  it('Klime : invulnérable au départ, levée par les dommages de poussée ; Pacifiste posé aux joueurs', () => {
    const p = bossProfile(data, 3384)
    const inv = p.mechanics.find(x => x.kind === 'invulnerable')!
    expect(inv.stateId).toBe(56)
    expect(inv.summary).toMatch(/poussée/)
    expect(inv.counters).toContain('push-damage')
    expect(p.mechanics.some(x => x.kind === 'pacifist' && x.stateId === 218)).toBe(true)
    expect(p.assumptions.some(a => /fenêtre de vulnérabilité/.test(a))).toBe(true)
  })

  it('effets de « phase de départ » non appliqués (Vortex : −100 PM retirés par « Action ! »)', () => {
    expect(bossProfile(data, 3835).mp).toBe(5)
  })
})

describe('profil offensif', () => {
  it('Merkator : sorts et pic mono-cible (Eau 1 092 ×1/cible, Terre 916)', () => {
    const p = bossProfile(data, 3534)
    const torp = p.spells.find(s => s.spellId === 4010)!
    expect(Math.round(torp.damageByElement[3])).toBe(1092)
    expect(p.phases).toHaveLength(1)
    expect(Math.round(p.phases[0].peakPerTurn)).toBe(2008)
    expect(p.incomingShares[1] + p.incomingShares[3]).toBeCloseTo(1, 9)
  })

  it('Vortex : sous-sorts suivis (Morfaille), drapeaux, phase Marginal', () => {
    const p = bossProfile(data, 3835)
    const morf = p.spells.find(s => s.spellId === 5070)!
    expect(Math.round(morf.damageByElement[0])).toBe(819)
    expect(Math.round(morf.damageByElement[3])).toBe(819)
    expect(morf.flags).toEqual(expect.arrayContaining(['hp-based', 'delayed', 'ring-excludes-target', 'sub-spell']))
    const marginal = p.phases.find(ph => ph.states.includes(236))!
    expect(marginal.name).toBe('Marginal')
    expect(marginal.spellIds).toContain(5064) // Contamination zombie : HS=236
    expect(p.phases.find(ph => ph.id === 'base')!.spellIds).not.toContain(5064)
  })

  it('Solar : tous les sorts exigent un état, mais au moins une phase frappe', () => {
    const p = bossProfile(data, 5100)
    expect(p.spells.every(s => s.requiredStates.length > 0)).toBe(true)
    expect(p.phases.find(ph => ph.id === 'base')!.peakPerTurn).toBe(0)
    const hitting = p.phases.filter(ph => ph.peakPerTurn > 0)
    expect(hitting.length).toBeGreaterThanOrEqual(1)
    expect(sum(p.incomingShares)).toBeCloseTo(1, 9)
    expect(p.warnings.some(w => /ne frappe pas/.test(w))).toBe(true)
    // Aurore, Zénith, Crépuscule : Solar invulnérable ; Nadir : vulnérable.
    expect(p.phases.find(ph => ph.states.includes(578))!.vulnerable).toBe(true)
    expect(p.phases.find(ph => ph.states.includes(575))!.vulnerable).toBe(false)
  })

  it('les dégâts en % de PV suivent les PV de référence (hypothèse affichée)', () => {
    const base = bossProfile(data, 3835).spells.find(s => s.spellId === 5062)! // 50 % des PV érodés de la cible
    const big = bossProfile(data, 3835, { refHp: 2 * DEFAULT_REF_HP }).spells.find(s => s.spellId === 5062)!
    expect(base.otherDamage).toBeGreaterThan(0)
    expect(big.otherDamage).toBeCloseTo(2 * base.otherDamage, 6)
    expect(bossProfile(data, 3835, { refHp: 5000 }).assumptions.join(' ')).toMatch(/5000 PV de référence/)
  })

  it('Kimbo : résistances de 400 % signalées comme mécanique', () => {
    const p = bossProfile(data, 1045)
    expect(p.warnings.some(w => /≥ 100 %/.test(w) && /mécanique/.test(w))).toBe(true)
    expect(p.mechanics.some(m => m.kind === 'extreme-res')).toBe(true)
  })
})

describe('fiche manuelle', () => {
  it('résistances, mécaniques et phases de la fiche remplacent ou complètent les données', () => {
    const ov: BossOverrides = {
      version: 1,
      monsterId: 1045,
      resPct: [0, 0, 0, 0, 0],
      phases: [{ id: 'glyphes', name: 'Glyphes posés', states: [], weight: 1, resPct: [0, 0, 400, 400, 0], vulnerable: true }],
      mechanics: [{ kind: 'res-change', summary: 'Glyphes : −400 % par paire.' }],
    }
    const p = bossProfile(data, 1045, { overrides: ov })
    expect(p.resPct).toEqual([0, 0, 0, 0, 0])
    expect(p.stats.fireResPct).toBe(0)
    expect(p.warnings.some(w => /≥ 100 %/.test(w))).toBe(false)
    expect(p.phases.map(ph => ph.id)).toEqual(['glyphes'])
    expect(p.phases[0]).toMatchObject({ weight: 1, resPct: [0, 0, 400, 400, 0] })
    expect(p.mechanics.at(-1)).toMatchObject({ kind: 'res-change', source: 'overrides' })
    expect(p.overrides?.monsterId).toBe(1045)
  })

  it('sorts exclus (hors phases) et positionnels (hors pic) ; monstre différent ⇒ erreur', () => {
    const excl = bossProfile(data, 3534, { overrides: { version: 1, monsterId: 3534, excludeSpells: [4010] } })
    expect(excl.spells.find(s => s.spellId === 4010)!.flags).toContain('excluded')
    expect(excl.phases[0].spellIds).not.toContain(4010)
    expect(Math.round(excl.phases[0].peakPerTurn)).toBe(916)
    const pos = bossProfile(data, 3534, { overrides: { version: 1, monsterId: 3534, positionalSpells: [4010] } })
    expect(pos.spells.find(s => s.spellId === 4010)!.flags).toContain('positional')
    expect(pos.phases[0].spellIds).toContain(4010)
    expect(Math.round(pos.phases[0].peakPerTurn)).toBe(916)
    expect(() => bossProfile(data, 3835, { overrides: { version: 1, monsterId: 3534 } })).toThrow(/concerne le monstre 3534/)
  })
})

describe('ensemble des boss', () => {
  const all = listBosses(data, nodeDungeonSource(data), { includeExpeditions: true })

  it('les 162 profils en moins de 2 s, cohérents', () => {
    const t0 = performance.now()
    const profiles = all.map(b => bossProfile(data, b.monsterId))
    const ms = performance.now() - t0
    expect(profiles).toHaveLength(162)
    expect(ms).toBeLessThan(2000)
    for (const p of profiles) {
      expect(p.phases.length).toBeGreaterThanOrEqual(1)
      expect(sum(p.phases.map(ph => ph.weight))).toBeCloseTo(1, 9)
      for (const ph of p.phases) {
        expect(Number.isFinite(ph.peakPerTurn) && Number.isFinite(ph.sustainedPerTurn)).toBe(true)
        expect(ph.sustainedPerTurn).toBeLessThanOrEqual(ph.peakPerTurn + 1e-6)
      }
      const s = sum(p.incomingShares)
      expect(s === 0 || Math.abs(s - 1) < 1e-9).toBe(true)
    }
    // Seuls 3 boss n'ont aucun dégât direct calculable (Koulosse, Capitaine Ekarlatte, Tournesol Affamé).
    const silent = profiles.filter(p => !p.phases.some(ph => ph.peakPerTurn > 0)).map(p => p.monsterId)
    expect(silent.sort((a, b) => a - b)).toEqual([670, 3753, 7796])
  })

  it('déterministe (même résultat d’un appel à l’autre et d’un DataStore à l’autre)', () => {
    const a = JSON.stringify(bossProfile(data, 3835))
    expect(JSON.stringify(bossProfile(data, 3835))).toBe(a)
    expect(JSON.stringify(bossProfile(loadDataStore(), 3835))).toBe(a)
    expect(JSON.stringify(bossProfile(data, 5100))).toBe(JSON.stringify(bossProfile(data, 5100)))
  })
})

describe('pureté de src/theorycraft', () => {
  const dir = fileURLToPath(new URL('../src/theorycraft/', import.meta.url))
  const FORBIDDEN = /from\s+['"](node:[^'"]*|[^'"]*\/dungeons\/(vortex|generic\/dummy)[^'"]*)['"]/

  it("aucun module sauf node.ts n'importe 'node:', src/dungeons/vortex ni src/dungeons/generic/dummy", () => {
    const files = readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'node.ts')
    expect(files).toEqual(expect.arrayContaining(['bosses.ts', 'bossProfile.ts', 'index.ts', 'overrides.ts', 'types.ts']))
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(FORBIDDEN)
  })

  it("ni directement ni transitivement depuis l'API publique (index.ts)", () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(FORBIDDEN)
      for (const m of src.matchAll(/(?:import|export)\b[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
        const base = resolve(dirname(file), m[1])
        const next = [`${base}.ts`, join(base, 'index.ts')].find(existsSync)
        if (next) visit(next)
      }
    }
    visit(join(dir, 'index.ts'))
    expect(seen.size).toBeGreaterThan(10)
    expect([...seen].some(f => f.endsWith('node.ts') && f.includes('theorycraft'))).toBe(false)
  })
})
