/**
 * Section « Boss » du visualiseur — routes de l'API du serveur de développement (web/plugins/theory.ts), testées sans
 * HTTP par leurs fonctions pures : index des boss (Expéditions), presets de base, fiche de Merkator (joueurs, grade,
 * nom), fiche manuelle appliquée ou illisible, classement des classes (effort plafonné, composition du grade imposé,
 * rendu aligné sur la CLI), meilleur stuff (preset, lien RoxxSolver), erreurs 400 / 404 / 405, aiguillage, et corps des
 * POST refusés hors de la page elle-même (415, 403).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { BASE_PRESETS } from '../src/optimizer/team/presets'
import { playersForGrade } from '../src/theorycraft/bosses'
import { fmtNum } from '../src/theorycraft/formatBoss'
import { formatClasses } from '../src/theorycraft/formatClasses'
import { renderClasses } from '../web/src/boss-classes'
import { renderStuffResult } from '../web/src/boss-stuff'
import { HttpError, readJson } from '../web/plugins/store'
import {
  theoryBoss,
  theoryBosses,
  theoryClasses,
  theoryEnv,
  theoryPresets,
  theoryRoute,
  theoryStuff,
  THEORY_LIMITS,
  type TheoryParams,
} from '../web/plugins/theory'

const data = loadDataStore()
/** Dossier de fiches manuelles vide : les tests ne dépendent pas des fiches de data/bosses. */
const tmp = mkdtempSync(join(tmpdir(), 'dofussimu-theory-'))
const empty = join(tmp, 'vide')
mkdirSync(empty)
const env = theoryEnv(data, empty)
const MERKATOR = 3534
/** Résistances ≥ 100 % sans fiche manuelle : DPT soutenu nul pour tous les presets. */
const KIMBO = 1045
/** Lien partagé par l'utilisateur (Crâ, 2026-10-06), le même que tests/theory-stuff.test.ts. */
const ROXX =
  'https://roxxsolver.com/solver?build=AQGbyAL__04SSQw1SU4QNUpOETdSN1F9eTSZVfR29RuDAuN29wK2Ax5LHvGQZAUB_wEpAAgBLgABAS4AAQEuAAEBCQABAQgAAQEuAAEBKQAIASkACA&config=AQEDtg0AAwIEVgQVBgwA9AEMAAcGAPQBBgALyAAPAP9_BQmH7MP-Ifr0_WoHJv8BARsIAAEgAQABIAEAASABAAEHAQABBgEAASABAAEbCAABGwgA'

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Code HTTP de l'erreur levée par `fn` (échec du test si rien n'est levé ou si ce n'est pas une `HttpError`). */
function statusOf(fn: () => unknown): number {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError)
    return (e as HttpError).status
  }
  throw new Error('aucune erreur levée')
}

describe('GET bosses et presets', () => {
  it('index des boss : Expéditions exclues par défaut, incluses avec all', () => {
    const def = theoryBosses(env)
    expect(def).toHaveLength(137)
    expect(def.some(b => b.isExpedition)).toBe(false)
    for (const all of ['1', 'true', true]) expect(theoryBosses(env, { all })).toHaveLength(162)
    expect(theoryBosses(env, { all: '0' })).toHaveLength(137)
    expect(def.find(b => b.monsterId === MERKATOR)).toMatchObject({ name: 'Merkator', gradeCount: 5, dungeons: [{ name: 'Aquadôme de Merkator', level: 200 }] })
  })

  it('presets : les 49 presets de base, champs de l\'interface', () => {
    const list = theoryPresets()
    expect(list).toHaveLength(BASE_PRESETS.length)
    expect(list).toHaveLength(49)
    expect(new Set(list.map(p => p.id)).size).toBe(49)
    expect(new Set(list.map(p => p.breedId)).size).toBe(19)
    expect(list.find(p => p.id === 'cra_terre_mono')).toMatchObject({ breedId: 9, className: 'Crâ', element: 'earth' })
    for (const p of list) {
      expect(Object.keys(p).sort()).toEqual(['breedId', 'className', 'element', 'id', 'label', 'role', 'roleLabel'])
      expect(['earth', 'fire', 'water', 'air']).toContain(p.element)
    }
  })
})

describe('GET boss : fiche de Merkator', () => {
  it('par id (nombre ou texte) : 4 joueurs par défaut ⇒ grade 1, −50 % à distance', () => {
    for (const id of [MERKATOR, String(MERKATOR)]) {
      const p = theoryBoss(env, { id })
      expect(p).toMatchObject({ monsterId: MERKATOR, name: 'Merkator', grade: 1, players: 4, hp: 13000 })
      expect(p.stats.rangedResPct).toBe(50)
      expect(p.overrides).toBeUndefined()
    }
  })

  it('joueurs ou grade imposé, et résolution par nom', () => {
    expect(theoryBoss(env, { id: MERKATOR, players: '6' })).toMatchObject({ grade: 3, players: 6 })
    const g = theoryBoss(env, { id: MERKATOR, grade: 2 })
    expect(g.grade).toBe(2)
    expect(g.players).toBeUndefined()
    expect(theoryBoss(env, { id: 'merkator' }).monsterId).toBe(MERKATOR)
  })

  it('erreurs : 400 paramètre invalide, 404 boss inconnu', () => {
    expect(statusOf(() => theoryBoss(env, {}))).toBe(400)
    expect(statusOf(() => theoryBoss(env, { id: 99999 }))).toBe(404)
    expect(statusOf(() => theoryBoss(env, { id: 'zzzzqq' }))).toBe(404)
    // Nom ambigu (Comte Razof, Comte Harebourg) : 400 avec les candidats.
    expect(statusOf(() => theoryBoss(env, { id: 'comte' }))).toBe(400)
    for (const players of [0, 9, 'abc', 2.5]) expect(statusOf(() => theoryBoss(env, { id: MERKATOR, players }))).toBe(400)
    expect(statusOf(() => theoryBoss(env, { id: MERKATOR, grade: 6 }))).toBe(400)
    expect(statusOf(() => theoryBoss(env, { id: MERKATOR, players: 4, grade: 1 }))).toBe(400)
  })

  it('fiche manuelle appliquée ; fiche illisible signalée (fiche calculée sans elle)', () => {
    const dir = join(tmp, 'fiches')
    mkdirSync(dir)
    const mechanic = { kind: 'other', summary: 'Mécanique de test.' }
    writeFileSync(join(dir, `${MERKATOR}.json`), JSON.stringify({ version: 1, monsterId: MERKATOR, updatedAt: '2026-10-08', mechanics: [mechanic] }))
    const withSheet = theoryEnv(data, dir)
    const p = theoryBoss(withSheet, { id: MERKATOR })
    expect(p.overrides?.monsterId).toBe(MERKATOR)
    expect(p.mechanics).toContainEqual({ ...mechanic, source: 'overrides' })
    // Relue à chaque demande : une fiche cassée s'applique sans redémarrer… et ne bloque pas la fiche du boss.
    writeFileSync(join(dir, '4726.json'), '{ pas du JSON')
    const broken = theoryBoss(withSheet, { id: MERKATOR })
    expect(broken.overrides).toBeUndefined()
    expect(broken.warnings[0]).toMatch(/^Fiches manuelles \(data\/bosses\) illisibles, aucune appliquée : .*4726\.json : JSON invalide/)
  })
})

describe('POST classes et stuff', () => {
  it('classes : stuffs des presets contre Merkator, grade imposé', () => {
    const r = theoryClasses(env, { id: MERKATOR })
    expect(r.boss).toMatchObject({ monsterId: MERKATOR, grade: 1, players: 4 })
    expect(r.stuff).toBe('preset')
    expect(r.presets).toHaveLength(49)
    expect(r.axes.map(a => a.axis)).toEqual(['damage', 'survival', 'control', 'heal', 'team'])
    expect(r.composition.members).toHaveLength(4)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    // Grade imposé : composition de G + 3 personnages, comme la CLI (`boss … classes --grade G`).
    const g = theoryClasses(env, { id: MERKATOR, grade: 2 })
    expect(g.boss.grade).toBe(2)
    expect(g.players).toBe(playersForGrade(2))
    expect(g.players).toBe(5)
    expect(g.composition.members).toHaveLength(5)
  })

  it('classes : rendu de la page aligné sur formatClasses (facteur d’étalonnage indicatif, pas de DPT « étalonné »)', () => {
    const r = theoryClasses(env, { id: MERKATOR })
    const html = renderClasses(r, { axis: 'damage', sorts: new Map(), open: new Set() })
    const cli = formatClasses(r)
    expect(html).toContain('>Étal. preset<')
    expect(cli).toContain('Étal. preset')
    expect(html).not.toMatch(/Étalonné/)
    expect(cli).not.toMatch(/Étalonné/)
    // Même facteur affiché par la page et par la CLI (preset du tableau Dégâts dont le facteur n'est pas 1) ; jamais le
    // soutenu multiplié par ce facteur (ancienne cellule « 1 572 ×0,83 »).
    const byId = new Map(r.presets.map(e => [e.presetId, e]))
    const shown = r.axes.find(a => a.axis === 'damage')!.entries.map(x => byId.get(x.presetId)!).find(e => Math.abs(e.dpt.calibration - 1) > 0.005)!
    expect(shown).toBeDefined()
    const factor = `×${fmtNum(shown.dpt.calibration, 2)}`
    expect(html).toContain(`>${factor}<`)
    expect(cli).toContain(factor)
    expect(html).not.toContain(`${fmtNum(shown.dpt.calibrated)} <small`)
    // Résistances < 100 % : ni la page ni la CLI n'ont de colonne « Rés. levées ».
    expect(html).not.toContain('Rés. levées')
    expect(cli).not.toContain('Rés. levées')
    // Style de jeu (colonne « Jeu ») : le premier du tableau Dégâts, preset à distance, joué au contact contre Merkator
    // (« * » : différent du style du preset), explication en infobulle sur la page.
    expect(html).toContain('>Jeu (au contact)<')
    expect(cli).toContain('Jeu (au contact)')
    const first = byId.get(r.axes.find(a => a.axis === 'damage')!.entries[0].presetId)!
    expect(first.style).toMatchObject({ contact: true, presetContact: false, source: 'dpt' })
    expect(html).toContain(`title="Joué au contact : ${first.style.reason}"`)
    expect(html).toContain('contact* <small class="bv-sub">100 %</small>')
    expect(cli).toMatch(new RegExp(`${first.presetId} .* contact\\* \\(100 %\\)`))
  })

  it('classes : Kimbo sans fiche (résistances ≥ 100 %) — colonne « Rés. levées » sur la page comme dans la CLI', () => {
    const r = theoryClasses(env, { id: KIMBO })
    const html = renderClasses(r, { axis: 'damage', sorts: new Map(), open: new Set() })
    const cli = formatClasses(r)
    expect(r.presets.every(e => e.dpt.steady === 0)).toBe(true)
    expect(cli).toContain('Rés. levées')
    expect(html).toContain('>Rés. levées<')
    // La valeur qui départage les DPT nuls (premier du tableau Dégâts) est affichée par les deux rendus.
    const byId = new Map(r.presets.map(e => [e.presetId, e]))
    const first = byId.get(r.axes.find(a => a.axis === 'damage')!.entries[0].presetId)!
    expect(first.dpt.resLifted).toBeGreaterThan(0)
    const lifted = fmtNum(first.dpt.resLifted!)
    expect(html).toContain(`>${lifted}<`)
    expect(cli).toContain(lifted)
  })

  it('classes : paramètres invalides ⇒ 400, boss inconnu ⇒ 404', () => {
    expect(statusOf(() => theoryClasses(env, { id: MERKATOR, stuff: 'meilleur' }))).toBe(400)
    expect(statusOf(() => theoryClasses(env, { id: MERKATOR, profile: 'agressif' }))).toBe(400)
    expect(statusOf(() => theoryClasses(env, { id: MERKATOR, iterations: -1 }))).toBe(400)
    expect(statusOf(() => theoryClasses(env, { id: 1 }))).toBe(404)
  })

  it('classes : effort plafonné (une recherche par preset, calcul synchrone) — plus bas que celui du stuff', () => {
    expect(THEORY_LIMITS.classesIterations.max).toBe(10_000)
    expect(THEORY_LIMITS.classesIterations.max).toBeLessThan(THEORY_LIMITS.iterations.max)
    // 200 000 itérations × 49 presets ≈ 6 min de serveur gelé : refusé avant tout calcul.
    for (const iterations of [10_001, 200_000]) expect(statusOf(() => theoryClasses(env, { id: MERKATOR, stuff: 'optimized', iterations }))).toBe(400)
  })

  it('stuff : preset « cra:terre » contre Merkator (recherche courte)', () => {
    const r = theoryStuff(env, { id: MERKATOR, preset: 'cra:terre', iterations: 0, top: 2 })
    expect(r.character).toMatchObject({ presetId: 'cra_terre_mono', breedId: 9, input: 'preset' })
    expect(r.boss).toMatchObject({ monsterId: MERKATOR, rangedResPct: 50 })
    expect(r.options).toMatchObject({ iterations: 0, top: 2, elements: 'preset', profile: 'balanced' })
    expect(r.top.length).toBeGreaterThan(0)
    expect(r.top.length).toBeLessThanOrEqual(2)
    expect(r.best.sheet.items.length).toBeGreaterThan(0)
    // Joué au contact (100 % de son DPT soutenu au contact contre Merkator) : la page le dit et l'explique.
    expect(r.character).toMatchObject({ melee: true, style: { contact: true, source: 'dpt' } })
    expect(r.options.rangeNeed).toBe(0)
    const html = renderStuffResult(r, undefined)
    expect(html).toContain(' · Terre · au contact</p>')
    expect(html).toContain(`Joué au contact : ${r.character.style.reason} — PO non exigée, % dommages mêlée valorisés.`)
    expect(html).toContain('PO non exigée ici, joué au contact')
  })

  it('stuff : lien RoxxSolver, preset de la classe du lien facultatif', () => {
    const r = theoryStuff(env, { id: MERKATOR, roxx: ROXX, iterations: 0, top: 1 })
    expect(r.character).toMatchObject({ breedId: 9, input: 'roxx' })
    expect(r.start.origin).toBe('user')
    const err = (() => {
      try {
        theoryStuff(env, { id: MERKATOR, roxx: ROXX, preset: 'iop' })
      } catch (e) {
        return e as HttpError
      }
    })()
    expect(err?.status).toBe(400)
    expect(err?.message).toMatch(/n'est pas de la classe du lien \(Crâ\)/)
  })

  it('stuff : erreurs 400 (preset, lien, options) et 404 (boss)', () => {
    const base: TheoryParams = { id: MERKATOR, preset: 'cra_terre_mono' }
    expect(statusOf(() => theoryStuff(env, { id: MERKATOR }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { id: MERKATOR, preset: 'pas_un_preset' }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { id: MERKATOR, roxx: 'https://roxxsolver.com/solver?build=AAAA' }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { ...base, elements: 'feu' }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { ...base, top: 0 }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { ...base, iterations: 10_000_000 }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { ...base, rangeNeed: 'loin' }))).toBe(400)
    expect(statusOf(() => theoryStuff(env, { ...base, id: 99999 }))).toBe(404)
  })
})

describe('aiguillage des routes', () => {
  it('GET lit la requête, POST le corps ; 404 route inconnue, 405 mauvaise méthode', () => {
    expect(theoryRoute(env, { method: 'GET', route: '/bosses', query: new URLSearchParams('all=1') })).toHaveLength(162)
    expect(theoryRoute(env, { method: 'GET', route: 'presets' })).toHaveLength(49)
    expect(theoryRoute(env, { method: 'GET', route: 'boss', query: new URLSearchParams({ id: String(MERKATOR), grade: '3' }) })).toMatchObject({ grade: 3 })
    expect(statusOf(() => theoryRoute(env, { method: 'POST', route: 'stuff', body: { id: MERKATOR } }))).toBe(400)
    expect(statusOf(() => theoryRoute(env, { method: 'GET', route: 'inconnue' }))).toBe(404)
    expect(statusOf(() => theoryRoute(env, { method: 'GET', route: 'toString' }))).toBe(404)
    expect(statusOf(() => theoryRoute(env, { method: 'POST', route: 'boss' }))).toBe(405)
    expect(statusOf(() => theoryRoute(env, { method: 'GET', route: 'classes' }))).toBe(405)
    expect(statusOf(() => theoryRoute(env, { method: 'DELETE', route: 'bosses' }))).toBe(405)
  })
})

describe('corps des POST : la page elle-même seulement', () => {
  /** Requête POST simulée : en-têtes et corps. */
  const req = (headers: Record<string, string>, body = '{"id":3534}'): IncomingMessage =>
    Object.assign(Readable.from([Buffer.from(body)]), { headers: { host: 'localhost:5173', ...headers } }) as unknown as IncomingMessage
  /** Code HTTP du refus de `readJson` (0 : accepté). */
  const refused = async (headers: Record<string, string>): Promise<number> => {
    try {
      await readJson(req(headers))
      return 0
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      return (e as HttpError).status
    }
  }

  it('JSON de la page (fetch de boss-api.ts / stuffs-editor.ts) : accepté', async () => {
    expect(await readJson(req({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5173' }))).toEqual({ id: 3534 })
    // Sans en-têtes de navigateur (outil en ligne de commande) : JSON suffit.
    expect(await refused({ 'content-type': 'application/json; charset=utf-8' })).toBe(0)
  })

  it('POST « simple » d’une page tierce (text/plain, formulaire, sans type) : 415, aucun calcul lancé', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) expect(await refused({ 'content-type': type })).toBe(415)
    expect(await refused({})).toBe(415)
  })

  it('JSON d’une autre page (Sec-Fetch-Site, ou Origin d’un autre hôte) : 403', async () => {
    for (const site of ['cross-site', 'same-site']) expect(await refused({ 'content-type': 'application/json', 'sec-fetch-site': site })).toBe(403)
    for (const origin of ['https://exemple.org', 'http://localhost:5174', 'null']) expect(await refused({ 'content-type': 'application/json', origin })).toBe(403)
  })
})
