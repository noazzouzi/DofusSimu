/**
 * Theorycraft — utilités chiffrées d'un personnage (src/theorycraft/utilities.ts, docs/design/theorycraft.md §1.6) :
 * retrait PM de l'Enutrof, soins de l'Eniripsa sans le faux désenvoûtement des Mots (pièges des profils de sorts),
 * « dommages subis » du Crâ, de l'Iop, du Forgelance (posture Armé) et de l'Huppermage (combinaison dédoublonnée),
 * réduction et armure du Féca ; tours mixtes (retrait PM + PA, soin + bouclier : un seul budget de PA), retraits sûrs
 * plafonnés à la réserve, érosion pondérée (Tarot et Roulette de l'Ecaflip) ; pertinence contre les mécaniques d'un boss
 * (Père Ver ⇒ mêlée, Merkator ⇒ retrait PM puni, « % dommages finaux » anecdotique ignoré, glyphes sans faux atout
 * « placement », personnage qui ne frappe pas) ; tables de mécaniques et de limites de classe ; déterminisme ; modules
 * purs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSpellProfileIndex } from '../src/ai/core/spellProfile'
import { loadDataStore } from '../src/data/node'
import type { Fighter } from '../src/engine/types'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { bossFighter, playerFighterFromMember, theoryEngine, withStates } from '../src/theorycraft/fighters'
import { MECHANIC_KINDS } from '../src/theorycraft/overrides'
import { initialStance, STANCES } from '../src/theorycraft/stances'
import type { BossProfile } from '../src/theorycraft/types'
import {
  CLASS_CONFIDENCE,
  CLASS_MODEL_LIMITS,
  classConfidence,
  classUtilities,
  MECHANIC_RELEVANCE,
  mergeUtilities,
  relevance,
  uptime,
} from '../src/theorycraft/utilities'
import { runtimeImportClosure, runtimeImports } from './import-graph-helpers'

const data = loadDataStore()
const HAREBOURG = 3416
const PERE_VER = 4726
const MERKATOR = 3534
const harebourg = bossFighter(data, HAREBOURG, { grade: 1 })

/** Personnage d'un preset dans sa posture de début de combat (masque Zobal, Armé…). */
function playerOf(presetId: string): Fighter {
  const p = getPreset(presetId)
  const a = playerFighterFromMember(data, presetMember(p, data))
  return withStates(a, initialStance(p.breedId, a.spells.map(s => s.spellId)).states)
}

const util = (presetId: string, boss = harebourg) => classUtilities(data, playerOf(presetId), boss)

describe('utilités chiffrées', () => {
  it('Enutrof retrait PM : plusieurs PM retirés par tour contre l\'esquive du Comte Harebourg', () => {
    const u = util('enutrof_retrait_pm_eau')
    expect(harebourg.stats.mpParry).toBeGreaterThan(50)
    expect(u.values.mpRemoved.value).toBeGreaterThan(2)
    expect(u.values.mpRemoved.value).toBeLessThanOrEqual(harebourg.stats.mp)
    expect(u.values.mpRemoved.spells.join(' ')).toMatch(/Maladresse|Pelle Aurifère/)
    expect(u.tags).toContain('mp-removal')
    // L'esquive compte : à Retrait nul, moins de PM retirés.
    const weak = classUtilities(data, { ...playerOf('enutrof_retrait_pm_eau'), stats: { ...playerOf('enutrof_retrait_pm_eau').stats, mpReduction: 0 } }, harebourg)
    expect(weak.values.mpRemoved.value).toBeLessThan(u.values.mpRemoved.value)
    // Retraite Anticipée retire aussi les PM de tous les alliés (« A,g » sur toute la carte) : signalé.
    expect(u.notes.join(' ')).toMatch(/touche aussi les alliés.*Retraite Anticipée/)
  })

  it('retraits sûrs plafonnés à la réserve résultat par résultat : un boss à 1 PM ne perd jamais plus d\'1 PM', () => {
    const u = classUtilities(data, playerOf('enutrof_retrait_pm_eau'), { ...harebourg, stats: { ...harebourg.stats, mp: 1 } })
    expect(u.removal.mp.sure).toBeGreaterThan(0)
    expect(u.values.mpRemoved.value).toBeLessThanOrEqual(1 + 1e-9)
    expect(u.values.mpRemoved.value).toBeGreaterThan(0.5)
  })

  it('tour MIXTE de retrait : PM + PA en un seul budget de PA, jamais la somme des deux tours consacrés', () => {
    for (const id of ['enutrof_retrait_pm_eau', 'huppermage_entrave', 'cra_air_entrave']) {
      const a = playerOf(id)
      const u = classUtilities(data, a, harebourg)
      const mix = u.removal.combined
      const dedicated = [u.values.mpRemoved.value, u.values.apRemoved.value]
      expect(mix.apSpent, id).toBeLessThanOrEqual(a.stats.ap + 1e-9)
      // Au moins la meilleure réserve seule, et strictement moins que les deux tours consacrés additionnés.
      expect(mix.mp + mix.ap, id).toBeGreaterThanOrEqual(Math.max(...dedicated) - 1e-9)
      expect(mix.mp + mix.ap, id).toBeLessThan(dedicated[0] + dedicated[1])
    }
    // Réserve exclue (retrait puni) : le tour mixte ne vise que l'autre.
    const apOnly = classUtilities(data, playerOf('huppermage_entrave'), harebourg, { removalPools: ['ap'] })
    expect(apOnly.removal.combined.mp).toBe(0)
    expect(apOnly.removal.combined.ap).toBeCloseTo(apOnly.values.apRemoved.value, 6)
  })

  it('Eniripsa : soigne, sans le faux désenvoûtement des Mots (406 sur sa propre Fée)', () => {
    const u = util('eniripsa_soin_feu')
    expect(u.values.heal.value).toBeGreaterThan(1000)
    expect(u.tags).toContain('heal')
    // Tour mixte soin + bouclier : un budget de PA, pas la somme des deux rotations consacrées.
    expect(u.values.shield.value).toBeGreaterThan(0)
    expect(u.care.apSpent).toBeLessThanOrEqual(playerOf('eniripsa_soin_feu').stats.ap + 1e-9)
    expect(u.care.heal + u.care.shield).toBeGreaterThanOrEqual(Math.max(u.values.heal.value, u.values.shield.value) - 1e-9)
    expect(u.care.heal + u.care.shield).toBeLessThan(u.values.heal.value + u.values.shield.value)
    // Piège des profils bruts : Mot Espiègle est marqué « dispel » par spellProfile (sous-sort 406 sur la Fée).
    const idx = createSpellProfileIndex(theoryEngine(data))
    const motEspiegle = data.spellLevel(25877, { playerLevel: 200 })!
    expect(data.spell(25877)?.name).toBe('Mot Espiègle')
    expect(idx.of(motEspiegle).dispel).toBe(true)
    const dispel = u.values.dispel.spells.join(' | ')
    expect(dispel).not.toMatch(/Mot Espiègle|Mot Malicieux|Mot Tapageur|Vacarme|Mot Turbulent/)
    // Les lignes réservées à la Fée sont écartées et signalées.
    expect(u.notes.join(' ')).toMatch(/monstre précis/)
  })

  it('« dommages subis » posés sur le boss : Crâ ×115 (Tir Perçant), Iop ×115 (Bond), Forgelance ×107 en posture Armé', () => {
    const cra = util('cra_terre_mono')
    expect(cra.values.damageTaken.value).toBeCloseTo(15, 6)
    expect(cra.values.damageTaken.spells).toContain('Tir Perçant')
    expect(cra.tags).toContain('damage-taken-debuff')
    const iop = util('iop_terre_burst')
    expect(iop.values.damageTaken.value).toBeCloseTo(15, 6)
    expect(iop.values.damageTaken.spells.join(' ')).toMatch(/Bond|Massacre/)
    // Fer Rouge : le 1163 visible du sort est « client » ; le vrai est dans le sous-sort de la posture Armé.
    const forge = util('forgelance_zone_terre')
    expect(forge.states).toContain(3360)
    expect(forge.values.damageTaken.value).toBeCloseTo(7, 6)
    const unarmed = classUtilities(data, withStates(playerOf('forgelance_zone_terre'), []), harebourg)
    expect(unarmed.values.damageTaken.value).toBe(0)
  })

  it('Huppermage : combinaisons (Éruption ×115…) comptées une seule fois, comme des sources partagées', () => {
    const u = util('huppermage_quadra')
    expect(u.values.damageTaken.value).toBeCloseTo(15, 6)
    expect(u.values.damageTaken.spells[0]).toMatch(/Éruption.*via/)
    // Profils bruts : presque chaque sort élémentaire « retire des PM » via les combinaisons.
    const idx = createSpellProfileIndex(theoryEngine(data))
    const a = playerOf('huppermage_quadra')
    const raw = idx.ofFighter(a).filter(p => p.mpRemoval > 0).length
    expect(raw).toBeGreaterThanOrEqual(8)
    // Ici : la combinaison Enlisement est UNE source (au plus une fois par tour), noms nettoyés des balises du client.
    expect(u.values.mpRemoved.spells.filter(s => /Enlisement/.test(s))).toHaveLength(1)
    expect(u.values.mpRemoved.spells.join(' ')).not.toMatch(/<sprite/)
    expect(u.removal.mp.attempted).toBeLessThan(12)
    expect(u.notes.join(' ')).toMatch(/Sous-sorts partagés dédoublonnés/)
  })

  it('érosion pondérée : cartes aléatoires du Tarot (1 sur 22) presque nulles, Roulette (toute la carte, alliés compris) écartée', () => {
    const hybride = util('ecaflip_feu_hybride')
    expect(hybride.values.erosion.value).toBeLessThan(2)
    expect(hybride.tags).not.toContain('erosion')
    // Prédation (érosion 15 sûre, ennemis seuls) reste ; Roulette (« a,A » en zone « a ») est écartée et signalée.
    const zone = util('ecaflip_air_zone')
    expect(zone.values.erosion.value).toBeCloseTo(15, 6)
    expect(zone.values.erosion.spells).toEqual(['Prédation'])
    expect(zone.notes.join(' ')).toMatch(/Érosion de zone qui touche aussi les alliés, écartée : Roulette/)
    // Crâ : Tir Perçant (+25 % d'érosion sur la cible, sort sûr) intact.
    expect(util('cra_terre_mono').values.erosion.value).toBeGreaterThanOrEqual(20)
  })

  it('Féca protecteur : réduction alliée (Bouclier Féca, Ataraxie au premier coup) et armure (Rempart)', () => {
    const u = util('feca_protecteur')
    expect(u.values.allyReduction.value).toBeGreaterThan(10)
    expect(u.values.allyReduction.spells.join(' ')).toMatch(/Bouclier Féca|Ataraxie/)
    // Rempart : 12 × (1 + 200/20) = 132 par coup, 2 tours sur 3 (relance 3).
    expect(u.values.allyArmor.value).toBeCloseTo((132 * 2) / 3, 6)
    expect(u.tags).toContain('damage-reduction')
    expect(uptime(2, 3)).toBeCloseTo(2 / 3, 9)
    expect(uptime(-1, 5)).toBe(1)
  })

  it('apport offensif décomposé : Iop multi-zone (Bond ×115, Puissance, Précipitation +PA, Épée Divine +Dommages)', () => {
    const u = util('iop_multi_zone')
    const labels = u.offensiveGain.parts.map(p => p.label).join(' | ')
    expect(labels).toMatch(/dommages subis/)
    expect(labels).toMatch(/PA/)
    expect(u.offensiveGain.total).toBeCloseTo(u.offensiveGain.parts.reduce((s, p) => s + p.pct, 0), 9)
    expect(u.tags).toEqual(expect.arrayContaining(['ally-ap-mp', 'ally-damage', 'damage-taken-debuff']))
    // Puissance (sort de soutien pur, masque « a,A ») : +300 Puissance 3 tours sur 4 ; Précipitation : +5 PA puis −3 PA,
    // un tour sur deux ⇒ +1 PA en moyenne.
    expect(u.values.allyPower.value).toBeCloseTo(225, 6)
    expect(u.values.allyAp.value).toBeCloseTo(1, 6)
    // Un « a,A » porté par un sort qui frappe tombe sur le boss visé (combinaisons de l'Ecaflip : +50 Puissance).
    expect(util('ecaflip_feu_hybride').values.allyPower.value).toBe(0)
  })

  it('postures : la meilleure par utilité (Zobal : boucliers du Masque de l\'Intrépide même si le DPT prend le Psychopathe)', () => {
    const a = playerOf('zobal_psychopathe')
    const list = STANCES[14].map(st => classUtilities(data, withStates(a, st.states), harebourg))
    const merged = mergeUtilities(
      [list[1], list[0], list[2]],
      [STANCES[14][1].name, STANCES[14][0].name, STANCES[14][2].name],
    )
    expect(merged.values.shield.value).toBe(Math.max(...list.map(u => u.values.shield.value)))
    expect(merged.values.shield.value).toBeGreaterThan(list[1].values.shield.value)
    expect(merged.states).toEqual([99])
    expect(merged.notes[0]).toMatch(/meilleure posture/)
  })

  it('déterministe ; combattants intacts ; sérialisable JSON', () => {
    const a = playerOf('steamer_soutien')
    const before = JSON.stringify({ s: a.states, st: a.stats, cd: a.cooldowns })
    const x = classUtilities(data, a, harebourg)
    const y = classUtilities(data, a, harebourg)
    expect(JSON.stringify(x)).toBe(JSON.stringify(y))
    expect(JSON.parse(JSON.stringify(x))).toEqual(x)
    expect(JSON.stringify({ s: a.states, st: a.stats, cd: a.cooldowns })).toBe(before)
  })
})

describe('pertinence contre le boss', () => {
  it('Père Ver (invulnérable à distance) : atout « mêlée » pour l\'Iop, et pour le Crâ qui frappe aussi au contact ; limite « distance » d\'un pur distance', () => {
    const profile = bossProfile(data, PERE_VER)
    const ver = bossFighter(data, PERE_VER, { grade: profile.grade, stats: profile.stats })
    // Sans forme de DPT mesurée : étiquettes mêlée / distance tirées des COUPS POSSIBLES des sorts (règle du jeu, hits.ts :
    // un sort de PO 1 à N frappe au contact comme à distance ; classes.ts mesure la forme).
    const iopU = util('iop_terre_burst', ver)
    expect(iopU.tags).toContain('melee')
    const iop = relevance(profile, iopU)
    expect(iop.atouts.some(a => /^Mêlée — invulnérable à distance/.test(a))).toBe(true)
    // Crâ Terre : Flèche Vagabonde (PO 1 à 8) et d'autres flèches se lancent au contact — il s'adapte (atout, pas de limite).
    const craU = util('cra_terre_mono', ver)
    expect(craU.tags).toContain('range')
    expect(craU.tags).toContain('melee')
    expect(relevance(profile, craU).atouts.some(a => /^Mêlée — invulnérable à distance/.test(a))).toBe(true)
    expect(relevance(profile, craU).limites.some(l => /^Distance/.test(l))).toBe(false)
    // Un personnage qui ne frapperait qu'à distance : limite « distance », aucun atout « mêlée ».
    const rangedU = { ...craU, tags: craU.tags.filter(t => t !== 'melee') }
    const cra = relevance(profile, rangedU, { dealsDamage: false })
    expect(cra.limites.some(l => /^Distance — invulnérable à distance/.test(l))).toBe(true)
    expect(cra.atouts.some(a => /^Mêlée/.test(a))).toBe(false)
    // Qui ne touche pas le Père Ver : limite explicite, aucun atout lié aux dégâts (rafale…), mais l'érosion qu'il pose
    // sur le boss vaut pour toute l'équipe (Engine.erosionPercent de la cible) et reste un atout.
    expect(cra.limites[0]).toMatch(/^Ne touche pas le boss/)
    expect(cra.atouts.some(a => /^Rafale|^Dégâts de zone|^Dégâts indirects|^Multi-élément/.test(a))).toBe(false)
    expect(cra.atouts.some(a => /^Érosion — le boss se soigne/.test(a))).toBe(true)
    expect(relevance(profile, rangedU).limites.some(l => /^Ne touche pas/.test(l))).toBe(false)
    // Le Père Ver n'a pas de PM : le retrait PM est une limite.
    const enu = relevance(profile, util('enutrof_retrait_pm_eau', ver))
    expect(enu.limites).toContain('Retrait PM — le boss n\'a pas de PM.')
  })

  it('Merkator : retrait PM puni (riposte sur perte de PM) mais pas le retrait PA ; indéplaçable ⇒ placement sans valeur', () => {
    const profile = bossProfile(data, MERKATOR)
    const merk = bossFighter(data, MERKATOR, { grade: profile.grade, stats: profile.stats })
    const enu = relevance(profile, util('enutrof_pa_po_dps', merk))
    expect(enu.limites.some(l => /^Retrait PM — retrait PA\/PM puni/.test(l))).toBe(true)
    expect(enu.limites.some(l => /^Retrait PA — retrait PA\/PM puni/.test(l))).toBe(false)
    expect(enu.limites.some(l => /^Placement — indéplaçable/.test(l))).toBe(true)
    // « % Dommages finaux : +2 » (sur coup à distance) : anecdotique, pas d'atout « boucliers / soin » ; à +15 %, si.
    const eni = util('eniripsa_soin_feu', merk)
    expect(eni.tags).toContain('shield')
    const finalDamage = profile.mechanics.find(m => m.kind === 'final-damage')!
    expect(finalDamage.summary).toMatch(/\+2\b/)
    expect(relevance(profile, eni).atouts.some(a => /le boss frappe plus fort/.test(a))).toBe(false)
    const stronger: BossProfile = { ...profile, mechanics: profile.mechanics.map(m => (m === finalDamage ? { ...m, summary: '+15 % Dommages finaux (dès le début du combat).' } : m)) }
    expect(relevance(stronger, eni).atouts.some(a => /le boss frappe plus fort/.test(a))).toBe(true)
  })

  it('glyphes et pièges du boss (Comte Harebourg) : pas de faux atout « placement »', () => {
    const profile = bossProfile(data, HAREBOURG)
    expect(profile.mechanics.some(m => m.kind === 'marks')).toBe(true)
    for (const id of ['cra_feu_zone', 'eniripsa_soin_feu', 'enutrof_retrait_pm_eau', 'pandawa_placement']) {
      expect(relevance(profile, util(id)).atouts.some(a => /^Placement/.test(a)), id).toBe(false)
    }
  })

  it('tables : toutes les mécaniques ont une règle et une phrase ; toutes les classes ont leurs limites et une confiance', () => {
    expect(Object.keys(MECHANIC_RELEVANCE).sort()).toEqual([...MECHANIC_KINDS].sort())
    for (const r of Object.values(MECHANIC_RELEVANCE)) expect(r.note.length).toBeGreaterThan(10)
    expect(MECHANIC_RELEVANCE['invulnerable-range'].counters).toContain('melee')
    expect(MECHANIC_RELEVANCE.summons.counters).toContain('zone')
    expect(MECHANIC_RELEVANCE['boss-heal'].counters).toContain('erosion')
    expect(MECHANIC_RELEVANCE['cant-be-moved'].punishes).toContain('placement')
    expect(MECHANIC_RELEVANCE.erosion.punishes).toContain('heal')
    const breeds = data.listBreeds().map(b => b.id).sort((a, b) => a - b)
    expect(breeds).toHaveLength(19)
    expect(Object.keys(CLASS_MODEL_LIMITS).map(Number).sort((a, b) => a - b)).toEqual(breeds)
    expect(Object.keys(CLASS_CONFIDENCE).map(Number).sort((a, b) => a - b)).toEqual(breeds)
    // Classes dont une source de dégâts centrale est hors calcul : confiance basse.
    for (const b of [1, 2, 4, 10, 13, 15, 16]) expect(CLASS_CONFIDENCE[b]).toBe('basse')
    expect(classConfidence(3).level).toBe('haute')
    expect(classConfidence(3, { downgrade: 1, reasons: ['x'] })).toEqual({ level: 'moyenne', reasons: [...CLASS_MODEL_LIMITS[3], 'x'] })
    expect(classConfidence(9, { downgrade: 5 }).level).toBe('basse')
  })
})

describe('pureté', () => {
  it('utilities, formatBoss, formatClasses : ni `node:`, ni src/dungeons, ni le proxy de stuff, même indirectement', () => {
    const c = runtimeImportClosure(['utilities', 'formatBoss', 'formatClasses'].map(f => `src/theorycraft/${f}.ts`))
    expect(c.external.filter(x => x.spec.startsWith('node:'))).toEqual([])
    expect(c.files.filter(f => /^src\/dungeons\/|^src\/optimizer\/stuff\/(proxy|vortex|search)\.ts$/.test(f))).toEqual([])
  })

  it('classes.ts (qui tire le proxy) n\'importe jamais src/dungeons directement et n\'est pas exporté par index.ts', () => {
    const c = runtimeImportClosure(['src/theorycraft/classes.ts'])
    expect(c.external.filter(x => x.spec.startsWith('node:'))).toEqual([])
    const direct = runtimeImports(readFileSync('src/theorycraft/classes.ts', 'utf8'), 'classes.ts')
    expect(direct.filter(s => /dungeons/.test(s))).toEqual([])
    const index = runtimeImportClosure(['src/theorycraft/index.ts']).files
    for (const f of ['classes', 'utilities', 'formatBoss', 'formatClasses']) expect(index).not.toContain(`src/theorycraft/${f}.ts`)
  })
})
