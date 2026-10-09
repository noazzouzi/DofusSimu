/**
 * Theorycraft — STYLE DE JEU d'un preset contre un boss (src/theorycraft/target.ts `resolveStyle`, rotation.ts
 * `contactShare`) : un preset à distance est joué au contact s'il y porte la majorité de son DPT soutenu. Part du DPT
 * au contact (règle du jeu : coup que le boss subit le mieux, style du personnage à égalité, sorts de PO min ≥ 2 à
 * distance ; aucune sans dégâts), règles et priorités (choix explicite, boss attaquable seulement au contact, preset de
 * mêlée, seuil de 50 %), Crâ Terre mono contre Merkator (−50 % à distance : au contact, PO non exigée, libellés
 * cohérents) et contre le Comte Harebourg (symétrique : à distance, 6 PO visées ; --range 0), Iop Terre contre
 * Harebourg (au contact) et contre Hanshi (−50 % au contact : reste au contact, contradiction signalée), choix explicite
 * prioritaire (et contradiction signalée), même style dans la comparaison des classes et le meilleur stuff, au niveau
 * 200 comme au niveau 150 (personnages sans équipement), Kimbo sans fiche (aucun dégât : style du preset).
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import type { Fighter } from '../src/engine/types'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { rankClasses } from '../src/theorycraft/classes'
import { bossFighter, playerFighterFromMember, theoryDptTable, withStates } from '../src/theorycraft/fighters'
import { formatClasses } from '../src/theorycraft/formatClasses'
import { formatStuffVsBoss } from '../src/theorycraft/formatStuff'
import { CONTACT_TAG, possibleHits } from '../src/theorycraft/hits'
import { contactShare, sustainedDamage } from '../src/theorycraft/rotation'
import { stuffVsBoss } from '../src/theorycraft/stuff'
import { bossProxyOptions, CONTACT_SHARE, contactEdge, rangedEdge, resolveStyle } from '../src/theorycraft/target'
import type { BossProfile, ClassRanking, StuffVsBossResult } from '../src/theorycraft/types'
import { renderClasses } from '../web/src/boss-classes'

const data = loadDataStore()
const table = theoryDptTable(data)
const MERKATOR = 3534
const HAREBOURG = 3416
const PERE_VER = 4726
/** Hanshi : « réduction mêlée 50 % » (`meleeResPct` 50) — le symétrique de Merkator. */
const HANSHI = 6212
/** Kimbo : résistances de 400 % partout sans fiche manuelle (aucun dégât). */
const KIMBO = 1045
const FLECHE_TYRANNIQUE = 32448
/** Recherche courte : ces tests portent sur le style, pas sur la qualité de l'optimisation. */
const QUICK = { iterations: 0, restarts: 1, top: 1 } as const

const merkator = bossProfile(data, MERKATOR)
const harebourg = bossProfile(data, HAREBOURG)
const pereVer = bossProfile(data, PERE_VER)
const hanshi = bossProfile(data, HANSHI)
const kimbo = bossProfile(data, KIMBO)

/** Personnage d'un preset (stuff du preset), joué au contact ou non (étiquette `CONTACT_TAG`). */
function player(presetId: string, contact: boolean): Fighter {
  const a = playerFighterFromMember(data, presetMember(getPreset(presetId), data))
  const c = withStates(a, a.states)
  if (contact) c.tags[CONTACT_TAG] = true
  return c
}

/** Part du DPT soutenu au contact contre les phases attaquables du boss (cibles de `bossProxyOptions`), sans posture. */
function shareOf(presetId: string, p: BossProfile, contact: boolean) {
  const t = bossProxyOptions(p, { role: 'killer' }).options.targets!
  const targets = t.map(x => bossFighter(data, x.monsterId, { grade: x.grade ?? p.grade, stats: x.stats, states: x.states }))
  const weights = t.map(x => x.weight)
  const a = player(presetId, contact)
  const runs = targets.map(d => sustainedDamage(table, a, d))
  return { share: contactShare(table, a, targets, weights, runs), runs, weights, a }
}

describe('part du DPT soutenu portée par des coups au contact (contactShare)', () => {
  it('Crâ Terre mono : 100 % contre Merkator (−50 % à distance) ; contre le Comte Harebourg, 0 % joué à distance, 100 % au contact (égalité)', () => {
    const merk = shareOf('cra_terre_mono', merkator, false)
    expect(merk.share).toBeCloseTo(1, 9)
    // Ce n'est pas une rotation de sorts de mêlée : chacun de ses sorts se lance aussi à distance, c'est Merkator qui
    // fait choisir le coup au contact.
    const spells = merk.runs.flatMap(r => r.steadyBySpell.map(x => x.spellId))
    expect(spells.length).toBeGreaterThan(1)
    for (const id of spells) {
      const i = merk.a.spells.findIndex(s => s.spellId === id)
      expect(possibleHits(table.profiles.ofFighter(merk.a)[i]), merk.a.spells[i].name).toEqual({ melee: true, range: true })
    }
    // Harebourg ne distingue pas les coups : le style du personnage tranche (étiquette `CONTACT_TAG`).
    expect(shareOf('cra_terre_mono', harebourg, false).share).toBe(0)
    expect(shareOf('cra_terre_mono', harebourg, true).share).toBeCloseTo(1, 9)
  })

  it('Iop Terre contre Hanshi (−50 % au contact) : 0 %, même joué au contact — le boss fait choisir le coup à distance', () => {
    expect(hanshi.stats.meleeResPct).toBe(50)
    const r = shareOf('iop_terre_burst', hanshi, true)
    expect(r.share).toBe(0)
    expect(r.runs.some(x => x.steady > 0)).toBe(true)
    expect(shareOf('iop_terre_burst', harebourg, true).share).toBeCloseTo(1, 9)
  })

  it('aucun dégât (Kimbo sans fiche, 400 % partout) : aucune part mesurée', () => {
    const r = shareOf('cra_terre_mono', kimbo, false)
    expect(r.runs.every(x => x.steady === 0)).toBe(true)
    expect(r.share).toBeUndefined()
  })

  it('Crâ Feu joué au contact contre le Comte Harebourg : Flèche Tyrannique (PO 2 à 8) reste à distance — part = 1 − la sienne', () => {
    const r = shareOf('cra_feu_zone', harebourg, true)
    const i = r.a.spells.findIndex(s => s.spellId === FLECHE_TYRANNIQUE)
    expect(possibleHits(table.profiles.ofFighter(r.a)[i])).toEqual({ melee: false, range: true })
    let total = 0
    let tyrannique = 0
    r.runs.forEach((run, k) => {
      for (const x of run.steadyBySpell) {
        total += r.weights[k] * x.damage
        if (x.spellId === FLECHE_TYRANNIQUE) tyrannique += r.weights[k] * x.damage
      }
    })
    expect(tyrannique).toBeGreaterThan(0.05 * total)
    expect(r.share).toBeCloseTo(1 - tyrannique / total, 9)
    expect(r.share).toBeLessThan(1)
    expect(r.share).toBeGreaterThan(CONTACT_SHARE)
  })
})

describe('resolveStyle : règle unique et priorités', () => {
  it('ce qui fait mieux subir au boss les coups au contact (« −50 % à distance » de Merkator) ou à distance (« −50 % au contact » de Hanshi)', () => {
    expect(contactEdge(merkator)).toBe('−50 % à distance')
    expect(contactEdge(harebourg)).toBeUndefined()
    expect(contactEdge(hanshi)).toBeUndefined()
    expect(rangedEdge(hanshi)).toBe('−50 % au contact')
    expect(rangedEdge(merkator)).toBeUndefined()
    expect(rangedEdge(harebourg)).toBeUndefined()
  })

  it('seuil de 50 % du DPT soutenu au contact, explication quand le style diffère de celui du preset', () => {
    expect(CONTACT_SHARE).toBe(0.5)
    expect(resolveStyle(harebourg, 'cra_terre_mono', { contactShare: 0.49 })).toEqual({ contact: false, label: 'à distance', presetContact: false, source: 'preset', contactShare: 0.49 })
    // À 50 % : au contact ; Harebourg ne distingue pas les coups, la part vient de sorts qui ne frappent qu'au contact.
    expect(resolveStyle(harebourg, 'cra_terre_mono', { contactShare: 0.5 })).toEqual({
      contact: true,
      label: 'au contact',
      presetContact: false,
      source: 'dpt',
      contactShare: 0.5,
      reason: '50 % de son DPT soutenu contre ce boss passe par des coups au contact (sorts qui ne frappent qu\'au contact)',
    })
    expect(resolveStyle(merkator, 'cra_terre_mono', { contactShare: 1 }).reason).toBe(
      '100 % de son DPT soutenu contre ce boss passe par des coups au contact, que le boss subit mieux (−50 % à distance)',
    )
    // Sans mesure : style du preset.
    expect(resolveStyle(merkator, 'cra_terre_mono')).toEqual({ contact: false, label: 'à distance', presetContact: false, source: 'preset' })
  })

  it('règle symétrique : le style où passe la majorité du DPT ; boss attaquable seulement au contact ; sans dégâts, style du preset', () => {
    // Iop Terre : preset de mêlée qui porte son DPT au contact ; aucune explication.
    expect(resolveStyle(harebourg, 'iop_terre_burst', { contactShare: 1 })).toEqual({ contact: true, label: 'au contact', presetContact: true, source: 'preset', contactShare: 1 })
    // Hanshi (−50 % au contact) : tout son DPT passe à distance ⇒ joué à distance, et la sortie dit pourquoi.
    expect(resolveStyle(hanshi, 'iop_terre_burst', { contactShare: 0 })).toEqual({
      contact: false,
      label: 'à distance',
      presetContact: true,
      source: 'dpt',
      contactShare: 0,
      reason: '100 % de son DPT soutenu contre ce boss passe par des coups à distance, que le boss subit mieux (−50 % au contact)',
    })
    // Boss qui ne distingue pas les coups : sorts qui ne frappent qu'à distance.
    expect(resolveStyle(harebourg, 'iop_terre_burst', { contactShare: 0.2 })).toMatchObject({ contact: false, source: 'dpt' })
    expect(resolveStyle(harebourg, 'iop_terre_burst', { contactShare: 0.2 }).reason).toMatch(/^80 % .* \(sorts qui ne frappent qu'à distance\)$/)
    // Seuil : 50 % au contact suffit.
    expect(resolveStyle(harebourg, 'iop_terre_burst', { contactShare: 0.5 })).toMatchObject({ contact: true, source: 'preset' })
    // Père Ver (invulnérable à distance) : un preset à distance y est joué au contact, et la sortie dit pourquoi.
    expect(resolveStyle(pereVer, 'forgelance_zone_terre', { contactShare: 1 })).toMatchObject({ contact: true, source: 'boss', reason: 'le boss n\'est attaquable qu\'au contact' })
    // Sans dégâts (aucune part) : style du preset, sans explication.
    expect(resolveStyle(kimbo, 'cra_terre_mono', { contactShare: undefined })).toEqual({ contact: false, label: 'à distance', presetContact: false, source: 'preset' })
    expect(resolveStyle(kimbo, 'iop_terre_burst', { contactShare: undefined })).toMatchObject({ contact: true, source: 'preset' })
  })

  it('choix explicite prioritaire, dans les deux sens (la part mesurée reste affichée, et sa contradiction signalée)', () => {
    // À distance contre Merkator alors que tout le DPT passe au contact : le choix tient, la sortie dit ce qu'il fixe.
    expect(resolveStyle(merkator, 'cra_terre_mono', { contactShare: 1 }, false)).toEqual({
      contact: false,
      label: 'à distance',
      presetContact: false,
      source: 'explicit',
      contactShare: 1,
      mismatch: true,
      reason:
        'choix explicite (option melee), mais 100 % de son DPT soutenu contre ce boss passe par des coups au contact, que le boss subit mieux (−50 % à distance) : DPT et équivalences comptent ces coups au contact (% dommages mêlée) — le choix explicite ne fixe que la PO visée et le coup retenu à égalité',
    })
    expect(resolveStyle(merkator, 'iop_terre_burst', { contactShare: 0 }, false)).toMatchObject({ contact: false, source: 'explicit', reason: 'choix explicite (option melee)' })
    expect(resolveStyle(pereVer, 'cra_terre_mono', { contactShare: 0 }, false)).toMatchObject({ contact: false, source: 'explicit' })
    expect(resolveStyle(harebourg, 'cra_terre_mono', { contactShare: 1 }, true)).toEqual({
      contact: true,
      label: 'au contact',
      presetContact: false,
      source: 'explicit',
      contactShare: 1,
      reason: 'choix explicite (option melee)',
    })
  })
})

/** Stuffs génériques notés SOUS la PO visée par défaut (12 PA et 6 PM atteints, PO < 6). */
const shortRange = (r: StuffVsBossResult) => r.comparison.filter(e => e.origin === 'generic' && e.ap >= 12 && e.mp >= 6 && e.range < 6)

describe('Crâ Terre mono : au contact contre Merkator, à distance contre le Comte Harebourg', () => {
  const merk = stuffVsBoss(data, { preset: 'cra_terre_mono' }, merkator, QUICK)
  const hare = stuffVsBoss(data, { preset: 'cra_terre_mono' }, harebourg, QUICK)

  it('Merkator : joué au contact (100 % du DPT soutenu au contact), PO non exigée — plus de pénalité de PO', () => {
    expect(merk.character.melee).toBe(true)
    expect(merk.character.style).toMatchObject({ contact: true, label: 'au contact', presetContact: false, source: 'dpt' })
    expect(merk.character.style.contactShare).toBeCloseTo(1, 9)
    expect(merk.options.rangeNeed).toBe(0)
    // Générique Feu (12/6/5) : sans pénalité contre Merkator, ×0,95 contre Harebourg (une PO manquante).
    expect(shortRange(merk).length).toBeGreaterThan(0)
    for (const e of shortRange(merk)) expect(e.penalty, e.label).toBe(1)
    for (const e of shortRange(hare)) expect(e.penalty, e.label).toBeCloseTo(0.95, 9)
    // Équivalences : la PO ne vaut plus rien (ni pénalité ni effet modélisé), les % mêlée comptent, pas les % distance.
    const stats = merk.statWeights.items.map(x => x.stat)
    expect(stats).not.toContain('range')
    expect(stats).toContain('meleeDamagePct')
    expect(stats).not.toContain('rangedDamagePct')
    expect(merk.statWeights.notes.join(' ')).toMatch(/PO non exigée \(joué au contact\)/)
  })

  it('Merkator : libellés cohérents (personnage, explication, pénalité, hypothèses)', () => {
    const text = formatStuffVsBoss(merk)
    expect(text).toContain('élément Terre, au contact\n')
    expect(text).toContain(
      'Jeu : joué au contact : 100 % de son DPT soutenu contre ce boss passe par des coups au contact, que le boss subit mieux (−50 % à distance) — PO non exigée, % dommages mêlée valorisés.',
    )
    expect(text).toContain('sous les valeurs visées (12 PA, 6 PM, PO non exigée ;')
    expect(merk.assumptions.some(a => /joué au contact \(PO non exigée\) : 100 % de son DPT soutenu/.test(a))).toBe(true)
    expect(merk.assumptions.join('\n')).not.toMatch(/joué à distance|PO visées/)
  })

  it('Comte Harebourg (aucune asymétrie mêlée / distance) : à distance, 6 PO visées, % distance valorisés', () => {
    expect(hare.character.melee).toBe(false)
    expect(hare.character.style).toEqual({ contact: false, label: 'à distance', presetContact: false, source: 'preset', contactShare: 0 })
    expect(hare.options.rangeNeed).toBe(6)
    const w = Object.fromEntries(hare.statWeights.items.map(x => [x.stat, x]))
    expect(w.range?.objectivePenalty).toBeGreaterThan(0)
    expect(w.rangedDamagePct?.perPoint).toBeGreaterThan(w.meleeDamagePct?.perPoint ?? 0)
    const text = formatStuffVsBoss(hare)
    expect(text).toContain('élément Terre, à distance\n')
    expect(text).not.toContain('Jeu :')
    expect(hare.assumptions.some(a => /joué à distance \(6 PO visées.*\) — preset à distance, 0 % du DPT soutenu contre ce boss au contact \(seuil 50 %\)/.test(a))).toBe(true)
  })

  it('Comte Harebourg avec --range 0 (rangeNeed 0) : toujours à distance — la PO non exigée vient de l’option, pas du style', () => {
    const r = stuffVsBoss(data, { preset: 'cra_terre_mono' }, harebourg, { ...QUICK, rangeNeed: 0 })
    expect(r.character.style).toMatchObject({ contact: false, source: 'preset' })
    expect(r.options.rangeNeed).toBe(0)
    const notes = r.statWeights.notes.join(' ')
    expect(notes).toContain('PO non exigée (--range 0, option rangeNeed de l’API)')
    expect(notes).not.toContain('joué au contact')
    expect(r.assumptions.some(a => a.includes('joué à distance (PO non exigée, --range (option rangeNeed de l’API))'))).toBe(true)
    expect(formatStuffVsBoss(r)).toContain('élément Terre, à distance\n')
  })

  it('choix explicite prioritaire : option melee (style) et rangeNeed (PO visée, --range de la CLI)', () => {
    const far = stuffVsBoss(data, { preset: 'cra_terre_mono' }, merkator, { ...QUICK, melee: false })
    expect(far.character.style).toMatchObject({ contact: false, source: 'explicit', mismatch: true })
    expect(far.character.style.contactShare).toBeCloseTo(1, 9)
    expect(far.options.rangeNeed).toBe(6)
    // Le choix ne change pas le coup que Merkator subit le mieux : DPT et équivalences restent au contact, la sortie le dit.
    expect(far.start.damage.steady).toBeCloseTo(merk.start.damage.steady, 6)
    expect(far.statWeights.items.map(x => x.stat)).toContain('meleeDamagePct')
    expect(formatStuffVsBoss(far)).toContain(
      'Jeu : joué à distance : choix explicite (option melee), mais 100 % de son DPT soutenu contre ce boss passe par des coups au contact, que le boss subit mieux (−50 % à distance) : DPT et équivalences comptent ces coups au contact (% dommages mêlée) — le choix explicite ne fixe que la PO visée et le coup retenu à égalité — 6 PO visées.',
    )
    // Au contact contre Harebourg : mesuré avec ce style (à égalité, coups au contact), donc sans contradiction.
    const near = stuffVsBoss(data, { preset: 'cra_terre_mono' }, harebourg, { ...QUICK, melee: true })
    expect(near.character.style).toMatchObject({ contact: true, source: 'explicit', reason: 'choix explicite (option melee)' })
    expect(near.character.style.contactShare).toBeCloseTo(1, 9)
    expect(near.character.style.mismatch).toBeUndefined()
    expect(near.options.rangeNeed).toBe(0)
    const po = stuffVsBoss(data, { preset: 'cra_terre_mono' }, merkator, { ...QUICK, rangeNeed: 4 })
    expect(po.character.style).toMatchObject({ contact: true, source: 'dpt' })
    expect(po.options.rangeNeed).toBe(4)
    expect(po.assumptions.some(a => /joué au contact \(4 PO visées, --range/.test(a))).toBe(true)
  })
})

describe('Iop Terre contre le Comte Harebourg', () => {
  it('preset de mêlée : au contact, PO non exigée, sans explication (style du preset)', () => {
    const iop = stuffVsBoss(data, { preset: 'iop_terre_burst' }, harebourg, QUICK)
    expect(iop.character.style).toMatchObject({ contact: true, presetContact: true, source: 'preset' })
    expect(iop.character.style.reason).toBeUndefined()
    expect(iop.character.style.contactShare!).toBeGreaterThan(CONTACT_SHARE)
    expect(iop.options.rangeNeed).toBe(0)
  })
})

describe('même style dans la comparaison des classes et le meilleur stuff', () => {
  const ids = ['cra_terre_mono', 'iop_terre_burst', 'cra_feu_zone']
  const presets = ids.map(getPreset)
  const ranked: [BossProfile, ClassRanking][] = [merkator, harebourg].map(p => [p, rankClasses(data, p, { presets })])

  it('PresetEvaluation.style = StuffVsBossResult.character.style, preset par preset et boss par boss', () => {
    for (const [p, r] of ranked) {
      for (const id of ids) {
        const ev = r.presets.find(e => e.presetId === id)!
        expect(ev.style, `${id} contre ${p.name}`).toEqual(stuffVsBoss(data, { preset: id }, p, QUICK).character.style)
        expect(ev.utilities.damage?.contactShare).toBe(ev.style.contactShare)
      }
    }
    const [merk, hare] = ranked.map(x => x[1])
    expect(merk.presets.map(e => e.style.contact)).toEqual([true, true, true])
    expect(hare.presets.map(e => e.style.contact)).toEqual([false, true, false])
  })

  it('rendu texte des classes : colonne « Jeu », presets joués au contact par leur DPT expliqués', () => {
    const merk = ranked[0][1]
    const text = formatClasses(merk, { presets: true })
    expect(text).toMatch(/cra_terre_mono .* contact\* \(100 %\)/)
    expect(text).toMatch(/iop_terre_burst .* contact \(100 %\)/)
    expect(merk.assumptions.join('\n')).toMatch(/Joués au contact par leur DPT .* 2 preset\(s\) à distance sur 2 \(100 % chacun\) — le boss subit mieux les coups au contact \(−50 % à distance\) : cra_terre_mono, cra_feu_zone\./)
    const hareText = formatClasses(ranked[1][1], { presets: true })
    expect(hareText).toMatch(/cra_terre_mono .* distance \(0 %\)/)
    expect(ranked[1][1].assumptions.join('\n')).not.toMatch(/Joués au contact par leur DPT/)
  })
})

describe('preset de mêlée contre Hanshi (−50 % au contact) : joué à distance, comme la majorité de son DPT (règle symétrique)', () => {
  const iop = stuffVsBoss(data, { preset: 'iop_terre_burst' }, hanshi, QUICK)
  const ranked = rankClasses(data, hanshi, { presets: ['iop_terre_burst', 'cra_terre_mono'].map(getPreset) })

  it('style à distance (DPT), 6 PO visées, % dommages distance valorisés — et la sortie dit pourquoi', () => {
    expect(iop.character.style).toMatchObject({ contact: false, presetContact: true, source: 'dpt', contactShare: 0 })
    expect(iop.character.style.mismatch).toBeUndefined()
    expect(iop.options.rangeNeed).toBe(6)
    expect(iop.best.damage.steady).toBeGreaterThan(0)
    const stats = iop.statWeights.items.map(x => x.stat)
    expect(stats).toContain('rangedDamagePct')
    expect(stats).not.toContain('meleeDamagePct')
    const text = formatStuffVsBoss(iop)
    expect(text).toContain('élément Terre, à distance\n')
    expect(text).toContain(
      'Jeu : joué à distance : 100 % de son DPT soutenu contre ce boss passe par des coups à distance, que le boss subit mieux (−50 % au contact) — 6 PO visées.',
    )
    expect(text).not.toContain('% dommages mêlée valorisés')
  })

  it('classes : même style, « * » dans la colonne « Jeu », hypothèse qui liste les presets concernés', () => {
    const ev = ranked.presets.find(e => e.presetId === 'iop_terre_burst')!
    expect(ev.style).toEqual(iop.character.style)
    const text = formatClasses(ranked, { presets: true })
    expect(text).toMatch(/iop_terre_burst .* distance\* \(0 %\)/)
    expect(text).toMatch(/cra_terre_mono .* distance \(0 %\)/)
    expect(text).not.toContain('« ! » = style contredit')
    // Page web : même marque.
    const html = renderClasses(ranked, { axis: 'damage', sorts: new Map(), open: new Set() })
    expect(html).toContain('distance* <small class="bv-sub">0 %</small>')
    const assumptions = ranked.assumptions.join('\n')
    expect(assumptions).toMatch(/Joués à distance par leur DPT .* 1 preset\(s\) de mêlée sur 1 \(0 % au contact chacun\) — le boss subit mieux les coups à distance \(−50 % au contact\) : iop_terre_burst\./)
    expect(assumptions).not.toMatch(/Joués au contact par leur DPT/)
  })
})

describe('même style sous le niveau 200 : classes et stuff mesurent sur le même personnage (sans équipement)', () => {
  // Osamodas Pacte contre le Comte Harebourg au niveau 150 : sa part au contact dépend du stuff (sans équipement :
  // sous 50 % ; avec les objets niveau 200 du preset, invalides à ce niveau : au-dessus).
  const ids = ['osamodas_pacte', 'ecaflip_terre_entrave', 'iop_soutien', 'cra_terre_mono']
  const ranked = rankClasses(data, harebourg, { presets: ids.map(getPreset), level: 150 })

  it('PresetEvaluation.style = StuffVsBossResult.character.style au niveau 150', () => {
    for (const id of ids) {
      const ev = ranked.presets.find(e => e.presetId === id)!
      expect(ev.stuff).toBe('unstuffed')
      const r = stuffVsBoss(data, { preset: id }, harebourg, { ...QUICK, level: 150 })
      // Le stuff de départ de `stuff` garde les objets niveau 200 du preset (invalide) ; le style n'en dépend pas.
      expect(r.startValid, id).toBe(false)
      expect(r.character.style, id).toEqual(ev.style)
    }
    expect(ranked.assumptions.join('\n')).toContain('; personnage sans équipement, comme les mesures sous le niveau 200 ; sans dégâts, style du preset)')
  })
})

describe('Kimbo sans fiche (aucun dégât) : style du preset, aucune part affichée', () => {
  it('classes et stuff : même style, sans part au contact ; colonne « Jeu » à « — »', () => {
    const ranked = rankClasses(data, kimbo, { presets: ['iop_soutien', 'iop_terre_burst'].map(getPreset) })
    for (const ev of ranked.presets) {
      expect(ev.dpt.steady).toBe(0)
      expect(ev.style.contactShare).toBeUndefined()
      expect(ev.style).toMatchObject({ source: 'preset', contact: ev.style.presetContact })
    }
    const text = formatClasses(ranked, { presets: true })
    expect(text).toMatch(/iop_soutien .* distance \(—\)/)
    expect(text).toMatch(/iop_terre_burst .* contact \(—\)/)
    expect(text).toContain('« — » = aucun dégât contre ce boss, style du preset')
    const r = stuffVsBoss(data, { preset: 'iop_soutien' }, kimbo, QUICK)
    expect(r.character.style).toEqual(ranked.presets.find(e => e.presetId === 'iop_soutien')!.style)
    expect(r.options.rangeNeed).toBe(6)
    expect(r.assumptions.some(a => a.includes('preset à distance, aucun dégât contre ce boss (part au contact non mesurée)'))).toBe(true)
  })
})
