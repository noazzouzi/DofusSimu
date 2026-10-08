/**
 * CLI du theorycraft contre un boss (src/cli/theory.ts, branchée dans src/cli/simulate.ts) : `bosses` (liste,
 * recherche, Expéditions), `boss <nom|id>` (fiche, --players/--grade, --details, fiche manuelle et --no-overrides,
 * repli sur les Expéditions), `boss … classes` (texte + --out JSON), `boss … stuff` (une recherche courte : premier
 * preset de la classe, --out réutilisable par --build et par un fichier d'équipe), `degats` (comparé à damageRange /
 * expectedDamage calculés ici : Flèche Punitive du Crâ Terre contre 20 % de résistance Terre), erreurs en français
 * (boss inconnu, ambigu avec candidats, preset inconnu, options exclusives) et drapeaux booléens qui n'avalent pas le
 * positionnel suivant (`--json 147`).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Element, emptyStats } from '../src/core/types'
import { critChance } from '../src/damage/crit'
import { damageRange, expectedDamage, type DamageInput } from '../src/damage/damage'
import { loadDataStore } from '../src/data/node'
import { main, usage } from '../src/cli/simulate'
import { getPreset, presetBuild } from '../src/optimizer/team/presets'
import { loadTeamFile } from '../src/optimizer/team/teamfile'
import { computeBuildStats } from '../src/stats/build'
import { bossProfile, listBosses } from '../src/theorycraft/index'
import { nodeDungeonSource } from '../src/theorycraft/node'
import type { BossEntry, ClassRanking, StuffVsBossResult } from '../src/theorycraft/types'

let out: string[] = []
let err: string[] = []
beforeEach(() => {
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((...x: unknown[]) => void out.push(x.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...x: unknown[]) => void err.push(x.join(' ')))
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => vi.restoreAllMocks())

const text = () => out.join('\n')
const errors = () => err.join('\n')
const json = <T>(): T => JSON.parse(text()) as T

const data = loadDataStore()
const MERKATOR = 3534
const tmp = mkdtempSync(join(tmpdir(), 'dofussimu-cli-theory-'))

describe('CLI theorycraft : aide et index des boss', () => {
  it('usage : section « Theorycraft contre un boss » et commandes bosses / boss / degats', async () => {
    const u = usage()
    expect(u).toContain('Theorycraft contre un boss')
    for (const c of ['bosses [recherche]', 'boss <nom|id>', 'boss <nom|id> classes', 'boss <nom|id> stuff --class <classe|preset>', 'degats              --preset <preset>'])
      expect(u).toContain(c)
    expect(u).toMatch(/Commandes : .*\| bosses \| boss \| degats$/m)
    expect(await main(['help'])).toBe(0)
  })

  it('bosses : recherche sans accents, tableau ; --json ; Expéditions seulement avec --all', async () => {
    expect(await main(['bosses', 'merk'])).toBe(0)
    expect(text()).toMatch(/^Merkator\s+3534\s+Aquadôme de Merkator\s+200\s+220\s+5\s+non$/m)
    expect(text()).toContain('1 boss pour « merk » (Expéditions exclues : --all pour les inclure)')
    out = []
    expect(await main(['bosses', '--json'])).toBe(0)
    const classic = json<BossEntry[]>()
    expect(classic.length).toBe(listBosses(data, nodeDungeonSource(data)).length)
    expect(classic.every(e => !e.isExpedition)).toBe(true)
    out = []
    expect(await main(['bosses', '--all', '--json'])).toBe(0)
    const all = json<BossEntry[]>()
    expect(all.length).toBe(listBosses(data, nodeDungeonSource(data), { includeExpeditions: true }).length)
    expect(all.length).toBeGreaterThan(classic.length)
  })

  it('drapeaux booléens : « --json 147 » n’avale pas le positionnel (id du Bouftou Royal)', async () => {
    expect(await main(['bosses', '--json', '147'])).toBe(0)
    expect(json<BossEntry[]>().map(e => e.name)).toEqual(['Bouftou Royal'])
    out = []
    expect(await main(['boss', '--json', '147'])).toBe(0)
    expect(json<{ monsterId: number }>().monsterId).toBe(147)
  })

  it('bosses : aucune correspondance = message, pas une erreur', async () => {
    expect(await main(['bosses', 'zzzzzz'])).toBe(0)
    expect(text()).toContain('Aucun boss ne correspond à « zzzzzz »')
  })
})

describe('CLI theorycraft : fiche du boss', () => {
  it('fiche texte : grade déduit de 4 joueurs, résistance distance, donjon', async () => {
    expect(await main(['boss', 'merkator'])).toBe(0)
    const t = text()
    expect(t).toContain('Merkator (3534) — grade 1, 4 joueur(s)')
    expect(t).toContain('Autres résistances / bonus effectifs : distance 50 %.')
    expect(t).toContain('Donjon(s) : Aquadôme de Merkator (niv. 200)')
    expect(t).not.toContain('Sort de départ')
  })

  it('--players / --grade : grade du profil ; exclusifs ; bornes', async () => {
    expect(await main(['boss', String(MERKATOR), '--players', '6', '--json'])).toBe(0)
    let p = json<{ grade: number; players?: number }>()
    expect([p.grade, p.players]).toEqual([3, 6])
    out = []
    expect(await main(['boss', String(MERKATOR), '--grade', '2', '--json'])).toBe(0)
    p = json<{ grade: number; players?: number }>()
    expect([p.grade, p.players]).toEqual([2, undefined])
    expect(await main(['boss', 'merkator', '--players', '2', '--grade', '3'])).toBe(1)
    expect(errors()).toContain('Erreur : --players et --grade sont exclusifs')
    expect(await main(['boss', 'merkator', '--players', '9'])).toBe(1)
    expect(errors()).toContain('--players : entier entre 1 et 8 attendu (« 9 »)')
  })

  it('--details : tous les sorts du boss et arbre du sort de départ (texte et JSON)', async () => {
    expect(await main(['boss', 'merkator', '--details'])).toBe(0)
    const t = text()
    expect(t).toContain('Sorts du boss (grade 1, 4 sorts)')
    expect(t).toMatch(/Sondage de Bronze\s+4011\s+5\s+3\s+1\s+∞\s+0\s+0\s+—\s+916/)
    expect(t).toContain('Mer Kantile (sort 4009, grade 1)')
    expect(t).toContain('[950] État « Indéplaçable » (97)')
    expect(t).toContain('[792] Lance le sort « Mer Veille » (4008, grade 1) (cible a ; déclencheur MPA ; zone A1)')
    expect(t).toContain('[1163] Dommages subis x50% (cible C ; déclencheur DR)')
    expect(t).toContain('Absente : data/bosses/3534.json')
    out = []
    expect(await main(['boss', 'merkator', '--details', '--json'])).toBe(0)
    const tree = json<{ details: { startingSpellTree: { name: string; effects: { effectId: number; sub?: { name: string } }[] } } }>().details.startingSpellTree
    expect(tree.name).toBe('Mer Kantile')
    expect(tree.effects.filter(e => e.sub).map(e => e.sub!.name)).toContain('Mer Veille')
  })

  it('fiche manuelle appliquée par défaut (--bosses-dir), ignorée avec --no-overrides', async () => {
    const dir = mkdtempSync(join(tmp, 'bosses-'))
    writeFileSync(join(dir, `${MERKATOR}.json`), JSON.stringify({ version: 1, monsterId: MERKATOR, updatedAt: '2026-10-08', resPct: [50, 50, 50, 50, 50], notes: 'test' }))
    expect(await main(['boss', 'merkator', '--bosses-dir', dir, '--json'])).toBe(0)
    let p = json<{ resPct: number[]; overrides?: { monsterId: number } }>()
    expect(p.resPct).toEqual([50, 50, 50, 50, 50])
    expect(p.overrides?.monsterId).toBe(MERKATOR)
    out = []
    expect(await main(['boss', 'merkator', '--bosses-dir', dir])).toBe(0)
    expect(text()).toContain('Fiche manuelle appliquée (2026-10-08).')
    out = []
    expect(await main(['boss', 'merkator', '--bosses-dir', dir, '--no-overrides', '--json'])).toBe(0)
    p = json<{ resPct: number[]; overrides?: { monsterId: number } }>()
    expect(p.resPct).toEqual([14, 27, 16, 22, 12])
    expect(p.overrides).toBeUndefined()
  })

  it('boss d’Expédition : trouvé sans --all quand il n’existe pas ailleurs', async () => {
    const classic = new Set(listBosses(data, nodeDungeonSource(data)).map(e => e.monsterId))
    const exp = listBosses(data, nodeDungeonSource(data), { includeExpeditions: true }).find(e => !classic.has(e.monsterId))!
    expect(await main(['boss', String(exp.monsterId)])).toBe(0)
    expect(text()).toContain(`${exp.name} (${exp.monsterId})`)
    expect(text()).toContain('boss d’Expédition')
  })

  it('erreurs : boss inconnu, ambigu (candidats), nom manquant ou mal placé', async () => {
    expect(await main(['boss', 'zzzzzz'])).toBe(1)
    expect(errors()).toContain('Erreur : Aucun boss ne correspond à « zzzzzz ».')
    err = []
    expect(await main(['boss', 'comte'])).toBe(1)
    expect(errors()).toMatch(/^Erreur : « comte » est ambigu : .*Comte Harebourg \(3416, .*Précisez le nom ou donnez l'id du monstre\.$/)
    expect(errors()).toContain('Comte Razof (4803')
    err = []
    expect(await main(['boss', 'classes'])).toBe(1)
    expect(errors()).toContain('boss : nom ou id du boss attendu')
    err = []
    expect(await main(['boss', 'classes', 'merkator'])).toBe(1)
    expect(errors()).toContain('le nom ou l\'id du boss vient AVANT la sous-commande')
  })
})

describe('CLI theorycraft : classes et stuff', () => {
  it('classes : classement texte ; --out .json écrit le classement complet', async () => {
    const file = join(tmp, 'classes.json')
    expect(await main(['boss', 'merkator', 'classes', '--out', file])).toBe(0)
    const t = text()
    expect(t).toContain('Classes contre Merkator (3534) — grade 1, 4 joueur(s), niveau 200, stuffs génériques des presets')
    expect(t).toContain('Dégâts (DPT soutenu)')
    expect(t).toContain(`Classement : ${file}`)
    const r = JSON.parse(readFileSync(file, 'utf8')) as ClassRanking
    expect(r.stuff).toBe('preset')
    expect(r.boss.monsterId).toBe(MERKATOR)
    expect(r.axes.map(x => x.axis)).toEqual(['damage', 'survival', 'control', 'heal', 'team'])
    expect(await main(['boss', 'merkator', 'classes', '--iterations', '5'])).toBe(1)
    expect(errors()).toContain('--iterations et --profile : seulement avec --optimize')
  })

  it('stuff --class cra : premier preset de base (autres en note), --out réutilisable (--build, fichier d’équipe)', async () => {
    const file = join(tmp, 'builds', 'cra-merkator.json')
    expect(await main(['boss', 'merkator', 'stuff', '--class', 'cra', '--iterations', '0', '--restarts', '1', '--top', '2', '--out', file, '--json'])).toBe(0)
    const r = json<StuffVsBossResult & { out: string }>()
    expect(r.character.presetId).toBe('cra_feu_zone')
    expect(r.assumptions[0]).toBe(
      'Classe Crâ : preset « cra_feu_zone » (Crâ Feu zone), le premier preset de base de la classe ; autres presets : cra_air_entrave, cra_terre_mono (--class <preset> pour en choisir un ; --elements all compare les quatre éléments).',
    )
    expect(r.options.iterations).toBe(0)
    expect(r.options.restarts).toBe(1)
    expect(r.top.length).toBeLessThanOrEqual(2)
    expect(r.out).toBe(file)
    // Fichier « dofussimu-build » : champ `build` au format des fichiers d'équipe.
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved).toMatchObject({ kind: 'dofussimu-build', version: 1, source: 'theorycraft', preset: 'cra_feu_zone', class: 'cra', breedId: 9, boss: { monsterId: MERKATOR } })
    expect(saved.build.items).toEqual(r.best.build.items)
    expect(saved.build.characteristicPoints).toEqual(r.best.build.characteristicPoints)
    // Réutilisable dans un fichier d'équipe (chemin relatif au fichier d'équipe)…
    const team = join(tmp, 'equipe.json')
    writeFileSync(team, JSON.stringify({ version: 1, scenario: 'dummy', members: [{ class: 'cra', preset: 'cra_feu_zone', build: 'builds/cra-merkator.json' }] }))
    expect(loadTeamFile(team).composition.members[0].build?.items).toEqual(r.best.build.items)
    // … et par --build (classe et preset lus dans le fichier) : même stuff, mêmes dégâts que le build.
    out = []
    expect(await main(['degats', '--build', file, '--sort', 'Flèche Explosive', '--json'])).toBe(0)
    const d = json<{ character: { presetId?: string; breedId: number; valid: boolean } }>()
    expect(d.character).toMatchObject({ presetId: 'cra_feu_zone', breedId: 9, valid: true })
  })

  it('erreurs du stuff : preset inconnu, --roxx et --build exclusifs, personnage absent, build d’une autre classe', async () => {
    expect(await main(['boss', 'merkator', 'stuff', '--class', 'cra_fue_zone'])).toBe(1)
    expect(errors()).toContain('Erreur : Classe inconnue : « cra_fue_zone » — ni classe ni preset connu ; presets Crâ : cra_feu_zone')
    err = []
    expect(await main(['boss', 'merkator', 'stuff', '--class', 'cra', '--roxx', 'x', '--build', 'y.json'])).toBe(1)
    expect(errors()).toContain('Erreur : --roxx et --build sont exclusifs')
    err = []
    expect(await main(['boss', 'merkator', 'stuff'])).toBe(1)
    expect(errors()).toContain('stuff : --class <classe|preset> attendu')
    err = []
    const file = join(tmp, 'iop.json')
    writeFileSync(file, JSON.stringify({ preset: 'iop_terre_burst', build: { items: [] } }))
    expect(await main(['boss', 'merkator', 'stuff', '--class', 'cra', '--build', file])).toBe(1)
    expect(errors()).toContain('build d\'une autre classe que Crâ')
    err = []
    expect(await main(['boss', 'merkator', 'stuff', '--class', 'cra', '--elements', 'tout'])).toBe(1)
    expect(errors()).toContain('--elements : preset|all attendu (« tout »)')
  })
})

describe('CLI theorycraft : calculateur de dégâts', () => {
  const stats = computeBuildStats(presetBuild(getPreset('cra_terre_mono'), data), data).stats
  const lvl = data.spellLevel(32456, { playerLevel: 200 })!
  const e = lvl.effects.find(x => x.effectId === 97)!
  const ce = lvl.criticalEffects.find(x => x.effectId === 97)!
  const rolls = { min: e.diceNum, max: e.diceSide, critMin: ce.diceNum, critMax: ce.diceSide }
  const input = (defender: DamageInput['defender']): DamageInput => ({ attacker: stats, defender, element: Element.Earth, crit: false, isWeapon: false, isMelee: false, defenderIsPlayer: false })
  type Line = { element: number; normal: { min: number; max: number; mean: number }; crit: { min: number; max: number; mean: number }; critPct: number; expected: number }

  it('Flèche Punitive (32456) du Crâ Terre contre 20 % de rés. Terre : 451-496, 630-687, espérance 658,33', async () => {
    const target = { ...emptyStats(), earthResPct: 20 }
    const n = damageRange(input(target), rolls.min, rolls.max)
    const c = damageRange({ ...input(target), crit: true }, rolls.critMin, rolls.critMax)
    const pct = critChance(lvl.critChance, stats.critical)
    const exp = expectedDamage(input(target), null, rolls, pct)
    // Valeurs mesurées par la cartographie (calcul direct, sans la CLI).
    expect([n, c, pct]).toEqual([{ min: 451, max: 496 }, { min: 630, max: 687 }, 100])
    expect(exp).toBeCloseTo(658.33, 2)

    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--res', '0,20,0,0,0', '--json'])).toBe(0)
    const r = json<{ spell: { spellId: number; grade: number }; lines: Line[]; expectedTotal: number }>()
    expect(r.spell).toMatchObject({ spellId: 32456, grade: lvl.grade })
    expect(r.lines).toHaveLength(1)
    const l = r.lines[0]
    expect(l.element).toBe(Element.Earth)
    expect({ min: l.normal.min, max: l.normal.max }).toEqual(n)
    expect({ min: l.crit.min, max: l.crit.max }).toEqual(c)
    expect(l.critPct).toBe(pct)
    expect(l.expected).toBeCloseTo(exp, 9)
    expect(r.expectedTotal).toBeCloseTo(exp, 9)

    // Texte (par le nom, sans accents) et trace du jet max.
    out = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', 'fleche punitive', '--res', '0,20,0,0,0', '--trace'])).toBe(0)
    const t = text()
    expect(t).toContain('Flèche Punitive (sort 32456, grade 2) — Crâ niveau 200 (preset cra_terre_mono)')
    expect(t).toMatch(/^\s+1\s+Terre\s+97\s+451-496\s+473,20\s+630-687\s+658,33\s+100 %\s+658,33\s+—$/m)
    expect(t).toContain('Détail du jet max (34, coup normal) — ligne 1, Terre')
    expect(t).toContain('trunc(621 × (1 − 20 / 100)) = 496')
  })

  it('contre un boss : résistances EFFECTIVES de la fiche (Merkator : 50 % à distance) ; --crit : trace du critique', async () => {
    const boss = bossProfile(data, MERKATOR).stats
    const n = damageRange(input(boss), rolls.min, rolls.max)
    const exp = expectedDamage(input(boss), null, rolls, critChance(lvl.critChance, stats.critical))
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--boss', 'merkator', '--no-overrides', '--crit', '--json'])).toBe(0)
    const r = json<{ target: { kind: string; rangedResPct: number; resPct: number[] }; lines: (Line & { trace: { roll: number; damage: number; params: { crit: boolean } } })[] }>()
    expect(r.target).toMatchObject({ kind: 'boss', rangedResPct: 50, resPct: [14, 27, 16, 22, 12] })
    expect({ min: r.lines[0].normal.min, max: r.lines[0].normal.max }).toEqual(n)
    expect(r.lines[0].expected).toBeCloseTo(exp, 9)
    expect(r.lines[0].trace.roll).toBe(rolls.critMax)
    expect(r.lines[0].trace.params.crit).toBe(true)
    expect(r.lines[0].trace.damage).toBe(r.lines[0].crit.max)
  })

  it('lignes conditionnelles en clair, hors espérance d’un lancer (Flèche Dévorante)', async () => {
    expect(await main(['degats', '--preset', 'cra_feu_zone', '--sort', 'Flèche Dévorante', '--json'])).toBe(0)
    const r = json<{ lines: { condition?: string }[]; expectedTotal: number | null; skippedLines: number }>()
    expect(r.lines.length).toBeGreaterThan(5)
    expect(r.lines.every(l => l.condition)).toBe(true)
    expect(r.lines.map(l => l.condition)).toContain("cible avec l'état « Flèche Dévorante I » (573)")
    expect(r.expectedTotal).toBeNull()
    expect(r.skippedLines).toBe(1)
  })

  it('erreurs : sort ambigu ou inconnu, --boss et --res exclusifs, --res mal formé, --sort absent', async () => {
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', 'fleche'])).toBe(1)
    expect(errors()).toMatch(/« fleche » est ambigu : .*Flèche Punitive \(32456\)/)
    err = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '1'])).toBe(1)
    expect(errors()).toContain("Le sort 1 n'est pas un sort de cette classe")
    err = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--boss', 'merkator', '--res', '0,0,0,0,0'])).toBe(1)
    expect(errors()).toContain('--boss et --res sont exclusifs')
    err = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--res', '1,2'])).toBe(1)
    expect(errors()).toContain('--res : 5 pourcentages n,t,f,e,a attendus')
    err = []
    expect(await main(['degats', '--preset', 'cra_terre_mono'])).toBe(1)
    expect(errors()).toContain('degats : --sort <nom|id> attendu')
  })
})
