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
    // Koumiho, Kaiyo : % des PV de la cible (Terre).
    const base = bossProfile(data, 6394).spells.find(s => s.spellId === 17401)!
    const big = bossProfile(data, 6394, { refHp: 2 * DEFAULT_REF_HP }).spells.find(s => s.spellId === 17401)!
    expect(base.flags).toContain('hp-based')
    expect(base.otherDamage).toBeGreaterThan(0)
    expect(base.hpDamageByElement[1]).toBeCloseTo(base.otherDamage, 9)
    expect(big.otherDamage).toBeCloseTo(2 * base.otherDamage, 6)
    expect(bossProfile(data, 3835, { refHp: 5000 }).assumptions.join(' ')).toMatch(/5000 PV de référence/)
  })

  it('Kimbo : résistances de 400 % signalées comme mécanique', () => {
    const p = bossProfile(data, 1045)
    expect(p.warnings.some(w => /≥ 100 %/.test(w) && /mécanique/.test(w))).toBe(true)
    expect(p.mechanics.some(m => m.kind === 'extreme-res')).toBe(true)
  })
})

describe('tirages aléatoires, branches selon la cible, alliés, poisons', () => {
  const spell = (bossId: number, spellId: number) => bossProfile(data, bossId).spells.find(s => s.spellId === spellId)!
  const total = (s: { damageByElement: readonly number[]; otherDamage: number }) => sum(s.damageByElement) + s.otherDamage

  it('un seul groupe aléatoire est joué : Fwetage (5 éléments à 20 %) et Mythos (4 à 25 %) comptent une ligne', () => {
    const fwetage = spell(1194, 912) // Père Fwetar
    expect(total(fwetage)).toBeCloseTo(640.1, 1) // et non 5 × 640
    for (const v of fwetage.damageByElement) expect(v).toBeCloseTo(total(fwetage) / 5, 6)
    expect(fwetage.approximations).toEqual(['random'])
    const mythos = spell(827, 813) // Minotot
    expect(total(mythos)).toBeCloseTo(427, 6) // et non 4 × 427
    expect(mythos.damageByElement[0]).toBe(0)
  })

  it('branches exclusives selon la classe de la cible : Trahison (Servitude) garde une seule branche', () => {
    const trahison = spell(5955, 15129) // 19 branches B# × 4 sous-sorts à 25 %
    expect(total(trahison)).toBeCloseTo(351, 6)
    expect(trahison.approximations).toEqual(['random', 'target-branches'])
    expect(bossProfile(data, 5955).assumptions.some(a => /Branches exclusives/.test(a))).toBe(true)
  })

  it('poison « tout le combat » (63 tours) compté sur 6 tours au plus : Liquéfaction (Corruption)', () => {
    // 792 à 50 % → maladie aléatoire (9 × 1/9) → dégâts fixes TB pendant 63 tours : 6 tours comptés.
    expect(total(spell(6026, 15387))).toBeCloseTo(711.17, 1)
  })

  it("sous-sorts lancés par un allié du boss : non comptés, drapeau 'summon' et détail allyCasts", () => {
    const line = spell(3835, 5062) // Vortex, En temps et en heure : l'Auroraire (3833) lance 5061
    expect(total(line)).toBe(0)
    expect(line.flags).toContain('summon')
    expect(line.allyCasts).toEqual([{ spellId: 5061, monsterIds: [3833] }])
    expect(bossProfile(data, 3835).warnings.some(w => /allié du boss/.test(w) && /Auroraire/.test(w))).toBe(true)
    const celerite = spell(6014, 15266) // Guerre : les quatre armes frappent
    expect(total(celerite)).toBe(0)
    expect(celerite.allyCasts.flatMap(c => c.monsterIds)).toEqual([6010, 6011, 6012, 6013])
    expect(Math.max(...bossProfile(data, 6014).phases.map(ph => ph.peakPerTurn))).toBeLessThan(4000)
  })

  it('« dommages subis » 1163 lu comme le moteur (value quand les deux dés sont nuls)', () => {
    // Merkator dont le 1163 ×50 sur DR serait stocké dans `value` (forme d=0 v=50 des données 3.x).
    const start = data.spellLevel(4009, { grade: 1 })!
    const patched = { ...start, effects: start.effects.map(e => (e.effectId === 1163 ? { ...e, diceNum: 0, diceSide: 0, value: 50 } : e)) }
    const store = new Proxy(data, {
      get(target, key) {
        if (key === 'spellLevel') return (id: number, sel: { grade?: number }) => (id === 4009 ? patched : target.spellLevel(id, sel))
        const v = Reflect.get(target, key, target)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    expect(bossProfile(store, 3534).stats.rangedResPct).toBe(50)
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
        // Borne de plausibilité (mesuré le 2026-10-08 : pic max 6 980, Dragon Cochon) : 3 × PV de référence par tour.
        expect(ph.peakPerTurn, `${p.name} / ${ph.name}`).toBeLessThan(3 * DEFAULT_REF_HP)
      }
      // Par lancer (max mesuré 4 621, Brouillard Empoisonné du Scarabosse Doré) : 2 × PV de référence.
      for (const s of p.spells) expect(sum(s.damageByElement) + s.otherDamage, `${p.name} / ${s.name}`).toBeLessThan(2 * DEFAULT_REF_HP)
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
  // Spécificateurs interdits : modules Node (préfixés ou non) et code Vortex / dummy.
  const SPEC = String.raw`(?:node:[^'"\`]*|(?:fs|path|os|url|child_process|module|worker_threads|crypto)(?:\/[^'"\`]*)?|[^'"\`]*\/dungeons\/(?:vortex|generic\/dummy)[^'"\`]*)`
  // Toutes les formes d'import : `from '…'`, `import '…'`, `import('…')`, `require('…')`.
  const FORBIDDEN = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"\`]${SPEC}['"\`]`)
  const RELATIVE = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g
  /** Source sans commentaires (les en-têtes citent « aucun import `node:` »). */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('le détecteur reconnaît les imports statiques, dynamiques, nus et require', () => {
    for (const src of [
      "import { readFileSync } from 'node:fs'",
      "export * from '../dungeons/vortex/scenario'",
      "import 'node:fs'",
      "const fs = await import('node:fs')",
      'const fs = require("fs")',
      "const d = await import('../dungeons/generic/dummy')",
    ])
      expect(code(src)).toMatch(FORBIDDEN)
    expect("import { critChance } from '../damage/crit'").not.toMatch(FORBIDDEN)
    expect(code("/** Module PUR : aucun import `node:`. */\nimport type { Stats } from '../core/types' // import 'node:fs'")).not.toMatch(FORBIDDEN)
  })

  it("aucun module sauf node.ts n'importe 'node:', src/dungeons/vortex ni src/dungeons/generic/dummy", () => {
    const files = readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'node.ts')
    expect(files).toEqual(expect.arrayContaining(['bosses.ts', 'bossProfile.ts', 'index.ts', 'overrides.ts', 'types.ts']))
    for (const f of files) expect(code(readFileSync(join(dir, f), 'utf8')), f).not.toMatch(FORBIDDEN)
  })

  it("ni directement ni transitivement depuis l'API publique (index.ts)", () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const src = code(readFileSync(file, 'utf8'))
      expect(src, file).not.toMatch(FORBIDDEN)
      for (const m of src.matchAll(RELATIVE)) {
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
