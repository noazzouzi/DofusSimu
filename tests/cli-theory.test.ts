/**
 * CLI du theorycraft contre un boss (src/cli/theory.ts, branchée dans src/cli/simulate.ts) : `bosses` (liste,
 * recherche, Expéditions), `boss <nom|id>` (fiche, --players/--grade, --details, fiche manuelle et --no-overrides,
 * repli sur les Expéditions), `boss … classes` (texte + --out JSON), `boss … stuff` (une recherche courte : premier
 * preset de la classe, --out réutilisable par --build et par un fichier d'équipe), `degats` (comparé à damageRange /
 * expectedDamage calculés ici : Flèche Punitive du Crâ Terre contre 20 % de résistance Terre ; coup au contact ou à
 * distance selon la case — Pression contre Merkator ; invulnérabilité à distance du Père Ver ; build nu complété par le
 * preset de son élément ; lignes réservées aux invocations écartées — Concentration ; un tableau par jeu de résistances
 * d'une fiche à résistances par phase — Kimbo ; aucun avertissement d'invulnérabilité sans ligne de dégâts — Bond),
 * erreurs en français (boss inconnu, ambigu avec candidats, preset inconnu, options exclusives, option inconnue ou d'une
 * autre commande, `--res` à entrée vide), fiche manuelle mal nommée signalée, ligne de progression fermée avant une
 * erreur, et drapeaux booléens qui n'avalent pas le positionnel suivant (`--json 147`).
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Element, emptyStats } from '../src/core/types'
import { critChance } from '../src/damage/crit'
import { damageRange, expectedDamage, type DamageInput } from '../src/damage/damage'
import { loadDataStore } from '../src/data/node'
import { main, usage } from '../src/cli/simulate'
import { playersForGrade, progressLine } from '../src/cli/theory'
import { getPreset, presetBuild } from '../src/optimizer/team/presets'
import { loadTeamFile } from '../src/optimizer/team/teamfile'
import { computeBuildStats } from '../src/stats/build'
import { bossProfile, listBosses, parseBossOverrides } from '../src/theorycraft/index'
import { nodeDungeonSource } from '../src/theorycraft/node'
import type { BossEntry, ClassRanking, StuffVsBossResult } from '../src/theorycraft/types'

let out: string[] = []
let err: string[] = []
/** Écritures directes sur stderr (progression). */
let progress: string[] = []
beforeEach(() => {
  out = []
  err = []
  progress = []
  vi.spyOn(console, 'log').mockImplementation((...x: unknown[]) => void out.push(x.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...x: unknown[]) => void err.push(x.join(' ')))
  vi.spyOn(process.stderr, 'write').mockImplementation((x: string | Uint8Array) => (progress.push(String(x)), true))
})
afterEach(() => vi.restoreAllMocks())

const text = () => out.join('\n')
const errors = () => err.join('\n')
const json = <T>(): T => JSON.parse(text()) as T

const data = loadDataStore()
const MERKATOR = 3534
const PERE_VER = 4726
const KIMBO = 1045
/** Fiche d'exemple du guide (docs/theorycraft.md §5) : deux phases, un élément à 0 % dans chacune. */
const KIMBO_FICHE = {
  version: 1,
  monsterId: KIMBO,
  name: 'Kimbo',
  updatedAt: '2026-10-08',
  phases: [
    { id: 'impair', name: 'Glyphe impair', states: [29], weight: 1, resPct: [400, 400, 400, 400, 0], vulnerable: true },
    { id: 'pair', name: 'Glyphe pair', states: [30], weight: 1, resPct: [400, 0, 400, 400, 400], vulnerable: true },
  ],
  notes: 'EXEMPLE FICTIF (tests).',
}
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
    // Coup : mêlée ⇔ PO ≤ 1 (convention des dégâts reçus, hits.ts).
    expect(t).toMatch(/Sondage de Bronze\s+4011\s+5\s+3\s+distance\s+1\s+∞\s+0\s+0\s+—\s+916/)
    expect(t).toMatch(/Torpillage de glace\s+4010\s+5\s+1\s+mêlée\s+2\s+1\s/)
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
    // Détail des dégâts pris sous un état du boss (`damageStates`, comme le tableau des sorts de `formatBoss`).
    out = []
    expect(await main(['boss', 'el piko', '--details'])).toBe(0)
    expect(text()).toMatch(/Pikak\s+7200\s+3\s+1\s+mêlée\s.*dégâts selon l'état du boss 441/)
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

  it('fiche invalide d’un AUTRE boss : sans effet ; celle du boss demandé : erreur qui cite le fichier', async () => {
    const dir = mkdtempSync(join(tmp, 'bosses-'))
    writeFileSync(join(dir, `${PERE_VER}.json`), JSON.stringify({ version: 1, monsterId: PERE_VER, updatedAt: '2026-10-08', resPct: 'bad' }))
    expect(await main(['boss', 'merkator', '--bosses-dir', dir, '--json'])).toBe(0)
    expect(json<{ monsterId: number }>().monsterId).toBe(MERKATOR)
    expect(await main(['boss', String(PERE_VER), '--bosses-dir', dir])).toBe(1)
    expect(errors()).toMatch(new RegExp(`^Erreur : .*${PERE_VER}\\.json : « resPct » : un tableau attendu`))
  })

  it('fiche mal nommée (kimbo.json) : ignorée par la CLI, mais signalée dans les avertissements de la fiche', async () => {
    const dir = mkdtempSync(join(tmp, 'bosses-'))
    writeFileSync(join(dir, 'kimbo.json'), JSON.stringify(KIMBO_FICHE))
    expect(await main(['boss', String(KIMBO), '--bosses-dir', dir, '--json'])).toBe(0)
    const p = json<{ overrides?: unknown; warnings: string[] }>()
    expect(p.overrides).toBeUndefined()
    expect(p.warnings[0]).toBe(`Fiche manuelle ${join(dir, 'kimbo.json')} ignorée : c'est une fiche de ce boss (monsterId ${KIMBO}), le fichier doit s'appeler ${KIMBO}.json.`)
    // Fichier mal nommé d'un autre boss : signalé aussi (la page web refuserait tout le dossier) ; --no-overrides : rien.
    out = []
    expect(await main(['boss', 'merkator', '--bosses-dir', dir, '--json'])).toBe(0)
    expect(json<{ warnings: string[] }>().warnings[0]).toMatch(/kimbo\.json ignoré : une fiche manuelle doit s'appeler <monsterId>\.json/)
    out = []
    expect(await main(['boss', 'merkator', '--bosses-dir', dir, '--no-overrides', '--json'])).toBe(0)
    expect(json<{ warnings: string[] }>().warnings.some(w => w.includes('kimbo.json'))).toBe(false)
  })

  it('option inconnue, ou d’une autre commande : refusée (jamais ignorée), avec les options de la commande', async () => {
    const file = join(tmp, 'fiche-out.json')
    expect(await main(['boss', 'merkator', '--out', file])).toBe(1)
    expect(errors()).toMatch(/^Erreur : boss : option inconnue --out — option de « boss … classes », « boss … stuff » \(options : --players, .*, --details, --json\)$/)
    expect(existsSync(file)).toBe(false)
    err = []
    expect(await main(['bosses', '--toto'])).toBe(1)
    expect(errors()).toBe('Erreur : bosses : option inconnue --toto (options : --all, --json)')
    err = []
    expect(await main(['boss', 'merkator', 'classes', '--class', 'cra'])).toBe(1)
    expect(errors()).toContain('boss … classes : option inconnue --class — option de « boss … stuff »')
    err = []
    // --level n'est pas une option de degats (niveau : celui du preset, du fichier --build ou du lien --roxx).
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--level', '150'])).toBe(1)
    expect(errors()).toContain('degats : option inconnue --level — option de « boss … classes », « boss … stuff »')
    err = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--bosses-dir', tmp])).toBe(1)
    expect(errors()).toBe('Erreur : --bosses-dir : seulement avec --boss')
  })

  it('--details : zone « ; » (liste de cases) lisible dans l’arbre du sort de départ', async () => {
    expect(await main(['boss', String(PERE_VER), '--details'])).toBe(0)
    expect(text()).toContain('[4] Téléporte sur la case ciblée (cible a,A ; zone 1 case(s) listée(s))')
    expect(text()).not.toContain('zone ;')
  })

  it('boss d’Expédition : trouvé sans --all quand il n’existe pas ailleurs', async () => {
    const classic = new Set(listBosses(data, nodeDungeonSource(data)).map(e => e.monsterId))
    const exp = listBosses(data, nodeDungeonSource(data), { includeExpeditions: true }).find(e => !classic.has(e.monsterId))!
    expect(await main(['boss', String(exp.monsterId)])).toBe(0)
    expect(text()).toContain(`${exp.name} (${exp.monsterId})`)
    expect(text()).toContain('boss d’Expédition')
  })

  it('erreurs : boss inconnu, ambigu (candidats), nom manquant ou mal placé', async () => {
    // Les Expéditions ont été cherchées : le message le dit (--all n'y changerait rien).
    expect(await main(['boss', 'zzzzzz'])).toBe(1)
    expect(errors()).toContain('Erreur : Aucun boss ne correspond à « zzzzzz » (Expéditions comprises).')
    err = []
    expect(await main(['boss', '999999'])).toBe(1)
    expect(errors()).toBe("Erreur : Aucun boss d'id 999999 (Expéditions comprises).")
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

  it('classes --grade G : composition pour le nombre de joueurs du grade (inverse de bossGradeFor)', async () => {
    expect([1, 2, 5, 6, 10].map(playersForGrade)).toEqual([4, 5, 8, 8, 8])
    expect(await main(['boss', 'merkator', 'classes', '--grade', '5'])).toBe(0)
    expect(text()).toContain('Classes contre Merkator (3534) — grade 5, 8 joueur(s)')
    expect(text()).toContain('Composition suggérée (8 personnage(s))')
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
    err = []
    // Conflit de classe : nom de la classe, pas son id.
    expect(await main(['degats', '--preset', 'cra', '--build', file, '--sort', '1'])).toBe(1)
    expect(errors()).toContain("build d'une autre classe que Crâ (Iop)")
  })

  it('stuff --build d’un build nu : preset de l’élément des objets, avertissement ; progression en français', async () => {
    const terre = presetBuild(getPreset('cra_terre_mono'), data)
    const file = join(tmp, 'nu-terre.json')
    writeFileSync(file, JSON.stringify({ breedId: 9, items: terre.items }))
    expect(await main(['boss', 'merkator', 'stuff', '--build', file, '--iterations', '0', '--restarts', '1', '--top', '1'])).toBe(0)
    expect(text()).toContain(
      "! --build nu-terre.json : points de caractéristiques, parchemins, variantes de sorts absent(s) du fichier — repris du preset « cra_terre_mono » (Crâ Terre mono-cible, choisi par l'élément dominant des objets : Terre)",
    )
    expect(progress.join('')).toMatch(/Recherche terminée en \d+,\d s\./)
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

  it('Pression (portée 1 à 4) contre Merkator : au contact (mêlée) ET à distance (50 % de rés. distance) ; --melee / --distance', async () => {
    const iop = computeBuildStats(presetBuild(getPreset('iop_terre_burst'), data), data).stats
    const pl = data.spellLevel(13106, { playerLevel: 200 })!
    const pe = pl.effects.find(x => x.effectId === 97)!
    const pc = pl.criticalEffects.find(x => x.effectId === 97)!
    const boss = bossProfile(data, MERKATOR).stats
    const at = (melee: boolean, crit = false): DamageInput => ({ attacker: iop, defender: boss, element: Element.Earth, crit, isWeapon: false, isMelee: melee, defenderIsPlayer: false })
    const pct = critChance(pl.critChance, iop.critical)
    const expect2 = (melee: boolean) => ({
      normal: damageRange(at(melee), pe.diceNum, pe.diceSide),
      crit: damageRange(at(melee, true), pc.diceNum, pc.diceSide),
      expected: expectedDamage(at(melee), null, { min: pe.diceNum, max: pe.diceSide, critMin: pc.diceNum, critMax: pc.diceSide }, pct),
    })
    const ranged = expect2(false)
    const melee = expect2(true)
    // Au contact, Merkator n'a aucune réduction : coup critique max 575 ; à distance, 50 % de moins (287).
    expect([ranged.crit.max, melee.crit.max]).toEqual([287, 575])
    type Hit = { melee: boolean; lines: Line[]; expectedTotal: number; identical?: boolean }
    const check = (h: Hit, e: typeof ranged) => {
      expect({ min: h.lines[0].normal.min, max: h.lines[0].normal.max }).toEqual(e.normal)
      expect({ min: h.lines[0].crit.min, max: h.lines[0].crit.max }).toEqual(e.crit)
      expect(h.expectedTotal).toBeCloseTo(e.expected, 9)
    }

    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--boss', 'merkator', '--no-overrides', '--json'])).toBe(0)
    const both = json<{ spell: { melee: boolean; hits: { melee: boolean; range: boolean } }; lines: Line[]; expectedTotal: number; otherHit: Hit }>()
    expect(both.spell).toMatchObject({ melee: false, hits: { melee: true, range: true } })
    check({ melee: false, lines: both.lines, expectedTotal: both.expectedTotal }, ranged)
    expect(both.otherHit).toMatchObject({ melee: true, identical: false })
    check(both.otherHit, melee)
    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--boss', 'merkator', '--no-overrides'])).toBe(0)
    expect(text()).toContain('3 PA · portée 1 à 4 · mêlée ou distance selon la case')
    expect(text()).toContain('À distance (cible à 2 cases ou plus)')
    expect(text()).toContain('Au contact (mêlée : cible sur une case adjacente)')

    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--boss', 'merkator', '--no-overrides', '--melee', '--crit', '--json'])).toBe(0)
    const m = json<{ spell: { melee: boolean }; lines: (Line & { trace: { damage: number } })[]; expectedTotal: number; otherHit?: Hit }>()
    expect(m.spell.melee).toBe(true)
    expect(m.otherHit).toBeUndefined()
    check({ melee: true, lines: m.lines, expectedTotal: m.expectedTotal }, melee)
    expect(m.lines[0].trace.damage).toBe(575)
    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--boss', 'merkator', '--no-overrides', '--distance', '--json'])).toBe(0)
    const d = json<{ spell: { melee: boolean }; lines: Line[]; expectedTotal: number; otherHit?: Hit }>()
    expect([d.spell.melee, d.otherHit]).toEqual([false, undefined])
    check({ melee: false, lines: d.lines, expectedTotal: d.expectedTotal }, ranged)

    // Poutch sans % mêlée / distance : un seul tableau, l'autre coup signalé identique.
    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--res', '0,20,0,0,0'])).toBe(0)
    expect(text()).toContain('Au contact (mêlée : cible sur une case adjacente) : mêmes valeurs')
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--melee', '--distance'])).toBe(1)
    expect(errors()).toContain('Erreur : --melee et --distance sont exclusifs')
  })

  it('Père Ver (invulnérable à distance) : coup à distance = 0 en jeu, signalé ; au contact calculé', async () => {
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--boss', String(PERE_VER), '--no-overrides', '--json'])).toBe(0)
    const r = json<{ lines: Line[]; expectedTotal: number; blocked?: string; warnings: string[]; target: { phases: { vulnerable: unknown }[] } }>()
    expect(r.target.phases.map(p => p.vulnerable)).toEqual(['melee'])
    expect(r.blocked).toBe('Père Ver est invulnérable à distance dans toutes ses phases (Base (aucun état))')
    expect([r.lines[0].normal.max, r.lines[0].crit.max, r.lines[0].expected, r.expectedTotal]).toEqual([0, 0, 0, 0])
    expect(r.warnings).toContain('Mécanique du boss : Invulnérable à distance : état « Invulnérable à Distance » (375) dès le début du combat.')
    expect(r.warnings.some(w => w.startsWith('Coup à distance : Père Ver est invulnérable à distance') && w.includes('0 en jeu'))).toBe(true)
    // Sort de portée 1 à 4 : le coup au contact passe en tête (non nul), celui à distance est bloqué.
    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Pression', '--boss', String(PERE_VER), '--no-overrides', '--json'])).toBe(0)
    const p = json<{ spell: { melee: boolean }; lines: Line[]; blocked?: string; otherHit: { melee: boolean; blocked?: string; lines: Line[] } }>()
    expect(p.spell.melee).toBe(true)
    expect(p.blocked).toBeUndefined()
    expect(p.lines[0].normal.max).toBeGreaterThan(0)
    expect(p.otherHit.melee).toBe(false)
    expect(p.otherHit.blocked).toContain('invulnérable à distance')
    expect(p.otherHit.lines[0].normal.max).toBe(0)
  })

  it('--crit sur un sort qui ne peut pas critiquer : trace du coup normal, signalé', async () => {
    expect(await main(['degats', '--preset', 'sadida_infection', '--sort', '13529', '--crit', '--json'])).toBe(0)
    const r = json<{ spell: { critPct: number }; lines: { trace: { params: { crit: boolean } } }[]; warnings: string[] }>()
    expect(r.spell.critPct).toBe(0)
    expect(r.lines[0].trace.params.crit).toBe(false)
    expect(r.warnings).toContain('--crit : « Vent Empoisonné » ne peut pas critiquer — trace du coup normal.')
  })

  it('--build d’un build nu { items } : points, parchemins et variantes du preset de l’élément des objets (signalé)', async () => {
    const full = presetBuild(getPreset('cra_terre_mono'), data)
    const file = join(tmp, 'nu-terre-degats.json')
    writeFileSync(file, JSON.stringify({ breedId: 9, items: full.items }))
    expect(await main(['degats', '--build', file, '--sort', '32456', '--json'])).toBe(0)
    const r = json<{ character: { presetId?: string }; attacker: Record<string, number>; warnings: string[] }>()
    expect(r.character.presetId).toBe('cra_terre_mono')
    // Mêmes caractéristiques que le preset complet (Force), pas les points Intelligence du premier preset (cra_feu_zone).
    expect(r.attacker.strength).toBe(stats.strength)
    expect(r.warnings[0]).toMatch(/^--build nu-terre-degats\.json : points de caractéristiques, parchemins, variantes de sorts absent\(s\) du fichier — repris du preset « cra_terre_mono »/)
  })

  it('Concentration (Iop) : la ligne réservée aux invocations (masque J,j) est écartée, comme dans le DPT du theorycraft', async () => {
    // Données : deux lignes Terre (97), l'une sur les joueurs et monstres non invoqués, l'autre sur les invocations.
    const cl = data.spellLevel(13123, { playerLevel: 200 })!
    expect(cl.effects.filter(x => x.effectId === 97).map(x => x.targetMask)).toEqual(['L,M,l,m,c', 'J,j'])
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Concentration', '--boss', 'merkator', '--no-overrides', '--json'])).toBe(0)
    const r = json<{ lines: (Line & { index: number; rolls: { min: number } })[]; expectedTotal: number; skippedLines: number; skipped: unknown; phaseTables?: unknown }>()
    expect(r.lines.map(l => [l.index, l.rolls.min])).toEqual([[1, 20]])
    expect(r.expectedTotal).toBeCloseTo(r.lines[0].expected, 9)
    expect(r.skippedLines).toBe(1)
    expect(r.skipped).toEqual([{ reason: 'sur les invocations', count: 1 }])
    // Phases du Merkator aux mêmes résistances : un seul tableau.
    expect(r.phaseTables).toBeUndefined()
    // Poutch (--res par défaut) : cible non invoquée, même tri ; raison dans le texte.
    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Concentration'])).toBe(0)
    expect(text()).toContain('Lignes de dégâts écartées (ne touchent pas la cible) : 1 sur les invocations.')
    expect(text()).not.toMatch(/^\s+2\s+Terre/m)
  })

  it('fiche à résistances par phase (Kimbo du guide) : un tableau par phase, aux résistances de la phase ; résistances ≥ 100 % signalées', async () => {
    const dir = mkdtempSync(join(tmp, 'bosses-'))
    writeFileSync(join(dir, `${KIMBO}.json`), JSON.stringify(KIMBO_FICHE))
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--boss', 'kimbo', '--bosses-dir', dir, '--json'])).toBe(0)
    type Table = { phases: string[]; weight: number; resPct: number[]; hit: { lines: Line[]; expectedTotal: number } }
    const r = json<{ phaseTables: Table[]; lines: Line[]; expectedTotal: number; target: { resPct: number[] }; warnings: string[] }>()
    expect(r.phaseTables.map(t => [t.phases, t.weight, t.resPct])).toEqual([
      [['Glyphe impair'], 0.5, [400, 400, 400, 400, 0]],
      [['Glyphe pair'], 0.5, [400, 0, 400, 400, 400]],
    ])
    // Phase impaire : Terre à 400 % ⇒ 0 ; phase paire : Terre à 0 %, caractéristiques du boss pour le reste.
    expect(r.phaseTables[0].hit.expectedTotal).toBe(0)
    const even = { ...bossProfile(data, KIMBO, { overrides: parseBossOverrides(KIMBO_FICHE, 'kimbo') }).stats, earthResPct: 0 }
    const pct = critChance(lvl.critChance, stats.critical)
    expect(r.phaseTables[1].hit.lines[0].normal).toMatchObject(damageRange(input(even), rolls.min, rolls.max))
    expect(r.phaseTables[1].hit.expectedTotal).toBeGreaterThan(0)
    expect(r.phaseTables[1].hit.expectedTotal).toBeCloseTo(expectedDamage(input(even), null, rolls, pct), 9)
    // Champs du premier tableau en tête ; mécanique « résistances extrêmes » relayée, valeur de la fiche signalée.
    expect([r.lines, r.expectedTotal, r.target.resPct]).toEqual([r.phaseTables[0].hit.lines, 0, [400, 400, 400, 400, 0]])
    expect(r.warnings.some(w => w.startsWith('Mécanique du boss : Résistances ≥ 100 %'))).toBe(true)
    expect(r.warnings).toContain('Résistance Terre 400 % pendant la phase Glyphe impair (≥ 100 %) : 0 dans le calcul. Valeur de la fiche manuelle.')
    out = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--boss', 'kimbo', '--bosses-dir', dir])).toBe(0)
    expect(text()).toContain('Résistances : selon la phase (tableaux ci-dessous)')
    expect(text()).toContain('Phase « Glyphe pair » (50 % du combat) — résistances : Neutre 400 %, Terre 0 %, Feu 400 %, Eau 400 %, Air 400 %')
    // Sans fiche : 400 % partout, un tableau, conseil d'écrire une fiche.
    out = []
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--boss', 'kimbo', '--no-overrides', '--json'])).toBe(0)
    const raw = json<{ phaseTables?: unknown; expectedTotal: number; warnings: string[] }>()
    expect([raw.phaseTables, raw.expectedTotal]).toEqual([undefined, 0])
    expect(raw.warnings.some(w => w.startsWith('Résistance Terre 400 % (≥ 100 %) : 0 dans le calcul. C\'est une mécanique à lever en combat'))).toBe(true)
  })

  it('sort sans ligne de dégâts (Bond) contre le Père Ver : aucun tableau, donc aucun avertissement « valeurs mises à 0 »', async () => {
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Bond', '--boss', String(PERE_VER), '--no-overrides', '--json'])).toBe(0)
    const r = json<{ lines: Line[]; warnings: string[] }>()
    expect(r.lines).toEqual([])
    expect(r.warnings.filter(w => w.startsWith('Coup '))).toEqual([])
    expect(r.warnings).toContain('Mécanique du boss : Invulnérable à distance : état « Invulnérable à Distance » (375) dès le début du combat.')
    out = []
    expect(await main(['degats', '--preset', 'iop_terre_burst', '--sort', 'Bond', '--boss', String(PERE_VER), '--no-overrides'])).toBe(0)
    expect(text()).toContain('Aucune ligne de dégâts sur la cible.')
    expect(text()).not.toContain("l'autre tableau")
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
    // Entrée vide : Number('') vaudrait 0 — une résistance oubliée n'est pas prise pour 0 %.
    expect(await main(['degats', '--preset', 'cra_terre_mono', '--sort', '32456', '--res', '0,,0,0,0'])).toBe(1)
    expect(errors()).toContain('--res : 5 pourcentages n,t,f,e,a attendus (Neutre, Terre, Feu, Eau, Air ; « 0,,0,0,0 »)')
    err = []
    expect(await main(['degats', '--preset', 'cra_terre_mono'])).toBe(1)
    expect(errors()).toContain('degats : --sort <nom|id> attendu')
  })
})

describe('CLI theorycraft : ligne de progression', () => {
  it('fermée (retour à la ligne) avant de laisser passer une erreur du calcul ; bilan en fin de calcul sinon', () => {
    const p = progressLine()
    const fail = () =>
      p.around(() => {
        p.write('Recherche : 1/3…')
        throw new Error('panne')
      })
    expect(fail).toThrow('panne')
    expect(progress.join('')).toBe(`${'\rRecherche : 1/3…'.padEnd(70)}\n`)
    progress = []
    const q = progressLine()
    expect(q.around(() => (q.write('2/3'), 42))).toBe(42)
    q.end('Recherche terminée.')
    expect(progress.join('')).toBe(`${'\r2/3'.padEnd(70)}${'\rRecherche terminée.'.padEnd(70)}\n`)
    // Rien d'affiché (sortie --json hors terminal) : rien n'est écrit, ni avant l'erreur ni en fin de calcul.
    progress = []
    const r = progressLine()
    expect(() =>
      r.around(() => {
        throw new Error('panne')
      }),
    ).toThrow('panne')
    r.end('fini')
    expect(progress).toEqual([])
  })
})
