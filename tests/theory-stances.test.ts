/**
 * Theorycraft — postures de classe (src/theorycraft/stances.ts, docs/design/theorycraft.md §1.4 bis) : ids d'états
 * vérifiés dans les données (spell-states, `statesCriterion` des sorts de classe), choix de la meilleure posture, et DPT
 * soutenu des classes à posture contre un boss neutre (non trivial une fois la posture posée).
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { compileTargetMask } from '../src/engine/targetMask'
import { criterionToClauses } from '../src/engine/criteria'
import { createSpellProfileIndex } from '../src/ai/core/spellProfile'
import { BASE_PRESETS, getPreset, presetMember } from '../src/optimizer/team/presets'
import { bossFighter, playerFighterFromMember, theoryDptTable, theoryEngine, withStates } from '../src/theorycraft/fighters'
import { sustainedDamage } from '../src/theorycraft/rotation'
import { bestStance, initialStance, NO_STANCE, STANCE_NOTES, STANCES, stancesOf } from '../src/theorycraft/stances'

const data = loadDataStore()
const table = theoryDptTable(data)
const boss = bossFighter(data, 3416, { grade: 1, stats: { neutralResPct: 0, earthResPct: 0, fireResPct: 0, waterResPct: 0, airResPct: 0 } })

/** États du LANCEUR cités par les sorts d'une classe (niveau 200, deux variantes) : `statesCriterion` et masques `*E…`. */
function casterStatesOf(breedId: number): Set<number> {
  const idx = createSpellProfileIndex(theoryEngine(data))
  const out = new Set<number>()
  for (const [x, y] of data.breed(breedId)!.spellPairs) {
    for (const id of [x, y]) {
      const lvl = data.spellLevel(id, { playerLevel: 200 })
      if (!lvl) continue
      for (const c of criterionToClauses(lvl.statesCriterion) ?? []) for (const s of [...c.has, ...c.not]) out.add(s)
      const p = idx.of(lvl)
      for (const line of p.damage) {
        for (const m of line.gates ? [line.mask, ...line.gates] : [line.mask]) {
          for (const cond of compileTargetMask(m).casterConditions) if (cond.code === 'E' || cond.code === 'e') out.add(cond.value)
        }
      }
      // Effets du sort (masques des effets utilitaires : Marée du Steamer…).
      for (const e of lvl.effects) for (const cond of compileTargetMask(e.targetMask ?? '').casterConditions) if (cond.code === 'E' || cond.code === 'e') out.add(cond.value)
    }
  }
  return out
}

describe('postures : données', () => {
  it('ids d\'états présents dans spell-states, aux noms attendus', () => {
    const names: Record<number, RegExp> = {
      98: /Intrépide/, 99: /Psychopathe/, 100: /Pleutre/, 3360: /Armé/, 3361: /Désarmé/, 3531: /Sobre/, 498: /Saoul/,
      3737: /^Portail$/, 3738: /^Errance$/, 5283: /Marée Basse/, 5282: /Marée Haute/, 513: /Rage/, 514: /Raage/, 515: /Rage Ouginak/,
      517: /Forme Bestiale/,
    }
    const used = new Set(Object.values(STANCES).flatMap(l => l.flatMap(s => s.states)))
    expect([...used].sort((a, b) => a - b)).toEqual(Object.keys(names).map(Number).sort((a, b) => a - b))
    for (const [id, re] of Object.entries(names)) expect(data.state(Number(id))?.name).toMatch(re)
    // Sorts qui fixent la posture de l'Eliotrope : Portail / Errance (même paire de variantes).
    expect(data.spell(14574)?.name).toBe('Portail')
    expect(data.spell(14604)?.name).toBe('Errance')
    expect(data.breed(16)!.spellPairs.some(([x, y]) => (x === 14574 && y === 14604) || (x === 14604 && y === 14574))).toBe(true)
  })

  it('chaque état de posture (Zobal, Forgelance, Pandawa, Steamer, Ouginak) est lu par un sort de la classe', () => {
    // Marée Basse (5283) n'est lue que par les sous-sorts de Marée (bascule) : les sorts lisent « sans Marée Haute » (e5282).
    const exempt = new Set([5283])
    for (const breedId of [14, 20, 12, 15, 18]) {
      const read = casterStatesOf(breedId)
      for (const s of STANCES[breedId]) {
        for (const st of s.states) if (!exempt.has(st)) expect(read.has(st), `classe ${breedId}, posture ${s.id}, état ${st}`).toBe(true)
      }
    }
  })

  it('une posture initiale par classe ; classes sans posture : NO_STANCE ; notes des états non modélisés', () => {
    for (const [breedId, list] of Object.entries(STANCES)) {
      expect(list.length).toBeGreaterThanOrEqual(2)
      expect(list.some(s => s.initial)).toBe(true)
      expect(new Set(list.map(s => s.id)).size).toBe(list.length)
      expect(initialStance(Number(breedId)).initial).toBe(true)
    }
    expect(initialStance(14).id).toBe('intrepide')
    expect(initialStance(20).id).toBe('arme')
    expect(initialStance(12).id).toBe('sobre')
    expect(stancesOf(9)).toEqual([NO_STANCE])
    expect(STANCE_NOTES[6]).toMatch(/Main/)
    expect(STANCE_NOTES[5]).toMatch(/Téléfrag/)
  })
})

describe('postures : choix', () => {
  it('bestStance : meilleure valeur, départage dans l\'ordre, phases de cycle exclues par défaut, sorts requis', () => {
    const v: Record<string, number> = { '98': 1, '99': 3, '100': 3 }
    const z = bestStance(14, st => v[String(st[0])])
    expect(z.stance.id).toBe('psychopathe')
    expect(z.value).toBe(3)
    expect(z.all.map(x => x.stance.id)).toEqual(['intrepide', 'psychopathe', 'pleutre'])
    // Ouginak : Forme Bestiale (phase de cycle) vaut le plus, mais n'est choisie que sur demande.
    const o = bestStance(18, st => (st.includes(517) ? 10 : st.length))
    expect(o.stance.id).not.toBe('bestiale')
    expect(o.all.find(x => x.stance.id === 'bestiale')!.value).toBe(10)
    expect(bestStance(18, st => (st.includes(517) ? 10 : st.length), { includeTransient: true }).stance.id).toBe('bestiale')
    // Eliotrope : la variante connue fixe la posture.
    expect(stancesOf(16, [14604]).map(s => s.id)).toEqual(['errance'])
    expect(stancesOf(16, [14574]).map(s => s.id)).toEqual(['portail'])
    // Classe sans posture : évaluée une fois, sans état.
    const calls: number[][] = []
    const c = bestStance(9, st => (calls.push(st), 42))
    expect(calls).toEqual([[]])
    expect(c.stance).toBe(NO_STANCE)
  })
})

describe('postures : DPT soutenu contre un boss neutre', () => {
  /** DPT soutenu médian des presets de base sans posture (référence « classe ordinaire »). */
  const median = (() => {
    const xs = BASE_PRESETS.filter(p => !STANCES[p.breedId]).map(p => sustainedDamage(table, playerFighterFromMember(data, presetMember(p, data)), boss).mean)
    xs.sort((a, b) => a - b)
    return xs[xs.length >> 1]
  })()

  it('Zobal, Forgelance, Pandawa : quasi nuls sans posture, au niveau des autres classes avec ; Eliotrope déjà non trivial', () => {
    const want: Record<string, string> = { zobal_psychopathe: 'psychopathe', forgelance_zone_terre: 'arme', pandawa_saoul: 'saoul', eliotrope_passeur: 'portail' }
    for (const [presetId, stanceId] of Object.entries(want)) {
      const p = getPreset(presetId)
      const a = playerFighterFromMember(data, presetMember(p, data))
      const before = sustainedDamage(table, a, boss).mean
      const choice = bestStance(p.breedId, st => sustainedDamage(table, withStates(a, st), boss).mean, { knownSpells: a.spells.map(s => s.spellId) })
      expect(choice.stance.id).toBe(stanceId)
      // Non trivial : au moins 80 % du DPT soutenu médian des classes sans posture.
      expect(choice.value).toBeGreaterThan(0.8 * median)
      if (p.breedId === 16) expect(choice.value).toBeCloseTo(before, 9)
      else expect(choice.value).toBeGreaterThan(1.5 * before)
      // Le combattant d'origine n'a pas changé de posture.
      expect(a.states).toEqual([])
    }
    // Sans posture, le Zobal ne lance presque rien (sorts à masque) : ≈ 0 en soutenu.
    const zobal = playerFighterFromMember(data, presetMember(getPreset('zobal_rempart'), data))
    expect(sustainedDamage(table, zobal, boss).mean).toBeLessThan(0.1 * median)
  })
})
