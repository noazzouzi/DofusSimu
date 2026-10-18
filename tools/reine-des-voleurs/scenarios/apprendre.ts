// Apprentissage : les combats d'une ou plusieurs sessions du journal (data/fightlogs/<jour>/session-<heure>.jsonl,
// écrits par le serveur de plans ou scripts/fightlog-server.mjs) ajoutés à la bibliothèque de leur placement.
//
// Chaque session contient les journaux des 4 Crâs et souvent plusieurs combats. Chaque combat est fusionné à part
// (tools/fightlog/fusion.ts : pendant son tour, le script d'un Crâ qui joue n'enregistre rien, les autres oui), puis
// reconstitué et vérifié contre les synchronisations du serveur (tools/fightlog/rejeu.ts), et ses tours de Crâ extraits
// (tools/fightlog/scenario.ts). Le placement est reconnu par l'espèce et la case des monstres au début du combat ;
// inconnu, il est ajouté au registre (« Auto … », Crâs sur les cases du placement par défaut).
//
// Le modificateur de dimension du combat est reconnu aux sorts lancés avant le premier tour (modificateurs.ts) ; inconnu,
// il est ajouté à son registre (« Auto … »). Les combats d'avant le nouveau départ (« depuis » du registre des
// placements) sont ignorés.
//
// Reclassement (reclassify) : chaque combat appris est rangé dans la bibliothèque de son placement d'après le registre
// actuel (après une correction du registre).
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fightsOf, mergeStreams, type Stream } from '../../fightlog/fusion'
import { scenarioFromRows, type Scenario } from '../../fightlog/scenario'
import { chainsOf, readJsonLines } from '../planificateur/journal'
import { addFight, libraryPath, loadLibrary, monstersOf, moveFight, saveLibrary, SCENARIOS_DIR, type Library } from './bibliotheque'
import { autoModifier, loadModifiers, modifierSpells, recognizeModifier, saveModifiers } from './modificateurs'
import { autoPlacement, crasOf, loadRegistry, recognize, saveRegistry, signature, type Registry } from './placements'

const QUEEN = 3726
/** Chef du groupe : son journal est préféré, à égalité, pour les tours des autres (comme le serveur de plans). */
const CHEF = 'Lowkey-Jealous'

/** Fichiers de session sous ces chemins (dossiers parcourus récursivement ; un fichier .jsonl donné est pris tel quel). */
export function sessionFiles(paths: string[]): string[] {
  const out: string[] = []
  const walk = (p: string, explicit: boolean) => {
    if (!existsSync(p)) throw new Error(`${p} : introuvable`)
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) walk(join(p, f), false)
    } else if (explicit ? p.endsWith('.jsonl') : /^session-.*\.jsonl$/.test(basename(p))) out.push(p)
  }
  for (const p of paths) walk(p, true)
  return [...new Set(out)]
}

/** Journaux des personnages d'une session (un par personnage ; journaux anciens sans nom : leur identifiant). */
export function streamsOf(file: string): Stream[] {
  const lines = readJsonLines(file)
  return chainsOf(lines)
    .filter(x => x.rows.length && (x.c || x.owner !== undefined))
    .map(x => ({ name: x.c ?? String(x.owner), rows: x.rows }))
}

export interface FightSource {
  /** Identifiant stable du combat : « <jour>/<session>.jsonl#<rang> ». */
  id: string
  scenario?: Scenario
  /** Raison pour laquelle le combat n'est pas appris (pas un combat de la Reine, reconstitution fausse…). */
  ignore?: string
}

/** Combats d'une session, chacun fusionné et extrait. */
export function fightsOfFile(file: string): FightSource[] {
  const streams = streamsOf(file)
  const prefer = [CHEF, ...streams.map(s => s.name).filter(n => n !== CHEF)]
  const label = `${basename(join(file, '..'))}/${basename(file)}`
  return fightsOf(streams).map((opt, k) => {
    const id = `${label}#${k + 1}`
    try {
      const merged = mergeStreams(streams, prefer, opt)
      if (!merged.rows.length) return { id, ignore: 'aucun journal ne contient ce combat' }
      const sources = Object.entries(merged.sources).map(([n, c]) => `${n} ${c}`).join(', ')
      const sc = scenarioFromRows('?', merged.rows, `${id} (tours pris chez ${sources || 'un seul journal'})`)
      if (!sc.monstres.some(m => m.espece === QUEEN)) return { id, ignore: 'pas un combat de la Reine des Voleurs' }
      return { id, scenario: sc }
    } catch (err) {
      return { id, ignore: (err as Error).message }
    }
  })
}

/**
 * Mode « 4 Crâs + mule » : les personnages qui ne sont pas des Crâs du registre (une mule qui passe ses tours) sont
 * retirés des tours appris et des morts (la mort de la mule est voulue : elle n'écarte aucun tour à la compilation).
 * Rend leurs noms.
 */
export function withoutMules(sc: Scenario, cras: ReadonlySet<string>): string[] {
  if (!cras.size) return []
  const mules = Object.keys(sc.ids).filter(n => !cras.has(n))
  if (!mules.length) return []
  const m = new Set(mules)
  for (const n of mules) delete sc.plans[n]
  for (const turns of Object.values(sc.plans)) for (const t of turns) if (t.morts) t.morts = t.morts.filter(x => !m.has(x))
  if (sc.issue) sc.issue.morts = sc.issue.morts.filter(x => !m.has(x.nom))
  return mules
}

/**
 * Sorts du début du combat qui signalent le modificateur : ceux des monstres, et ceux que TOUS les Crâs lancent (4655,
 * 4676, 4871…). Un sort lancé par une partie des joueurs seulement vient de leur équipement, d'un consommable (17307 et
 * 18888 le 2026-10-14) ou de la mule (8418, 14377 pour Kimera-Sekai). Sans le détail par lanceur : tous les sorts.
 */
export function modifierCasts(sc: Scenario, cras: ReadonlySet<string>): number[] {
  if (!sc.sortsDebutJoueurs || !sc.sortsDebutMonstres) return sc.sortsDebut ?? []
  const parJoueur = sc.sortsDebutJoueurs
  const presents = Object.keys(sc.ids).filter(n => !cras.size || cras.has(n))
  const parTous = presents.length ? (parJoueur[presents[0]] ?? []).filter(s => presents.every(n => (parJoueur[n] ?? []).includes(s))) : []
  return [...new Set([...sc.sortsDebutMonstres, ...parTous])].sort((a, b) => a - b)
}

export interface LearnReport {
  lignes: string[]
  appris: number
  ignores: number
  /** Combats d'avant le nouveau départ (« depuis » du registre), ignorés. */
  anterieurs: number
  /** Placements créés (monstres inconnus). */
  nouveaux: string[]
  /** Modificateurs créés (sorts du début de combat inconnus). */
  nouveauxModificateurs: string[]
  /** Fichiers de bibliothèque écrits. */
  ecrits: string[]
}

/**
 * Apprend les combats de ces sessions : chaque combat va dans la bibliothèque de son placement (data/reine/scenarios),
 * le registre (data/reine/placements.json) reçoit les placements inconnus. `dryRun` : rien n'est écrit.
 */
export function learn(paths: string[], opts: { root?: string; dryRun?: boolean } = {}): LearnReport {
  const root = opts.root ?? process.cwd()
  const reg: Registry = loadRegistry(root)
  const cras = new Set(Object.keys(crasOf(reg)))
  const mods = loadModifiers(root)
  const libs = new Map<string, Library>()
  const report: LearnReport = { lignes: [], appris: 0, ignores: 0, anterieurs: 0, nouveaux: [], nouveauxModificateurs: [], ecrits: [] }
  // Session close avant le nouveau départ : aucun de ses combats n'est à apprendre (pas besoin de la relire).
  const files = sessionFiles(paths).filter(file => !reg.depuis || statSync(file).mtime.toISOString() >= reg.depuis)
  if (!files.length) report.lignes.push(`aucune session (session-*.jsonl) sous ${paths.join(', ')}${reg.depuis ? ` depuis le ${reg.depuis}` : ''}`)
  let regChanged = false
  let modsChanged = false
  for (const file of files) {
    report.lignes.push(`${relative(root, file) || file}`)
    for (const f of fightsOfFile(file)) {
      if (reg.depuis && f.scenario?.debut && f.scenario.debut < reg.depuis) {
        report.anterieurs++
        continue
      }
      if (!f.scenario) {
        report.ignores++
        report.lignes.push(`  ${f.id} : ignoré — ${f.ignore}`)
        continue
      }
      const sc = f.scenario
      const mules = withoutMules(sc, cras)
      const sorts = modifierSpells(mods, modifierCasts(sc, cras))
      let mod = recognizeModifier(mods, sorts)
      if (!mod) {
        mod = autoModifier(sorts, mods.modificateurs.map(x => x.nom))
        mods.modificateurs.push(mod)
        report.nouveauxModificateurs.push(mod.nom)
        modsChanged = true
      }
      let p = recognize(reg, sc.monstres)
      const created = !p
      if (!p) {
        p = autoPlacement(sc.monstres.map(m => ({ espece: m.espece, cellule: m.cellule, nom: m.nom })), reg.placements.map(x => x.nom))
        if (mules.length) p.mule = true
        reg.placements.push(p)
        report.nouveaux.push(p.nom)
        regChanged = true
      }
      for (const [who, id] of Object.entries(sc.ids)) {
        if (mules.includes(who)) continue
        if (reg.personnages[who] !== id) {
          reg.personnages[who] = id
          regChanged = true
        }
      }
      let lib = libs.get(p.nom)
      if (!lib) {
        lib = loadLibrary(p.nom, root)
        libs.set(p.nom, lib)
      }
      const r = addFight(lib, f.id, sc, mod.nom)
      if (mules.length) lib.combats.find(c => c.id === f.id)!.mules = mules
      report.appris++
      const issue = sc.issue!
      const morts = issue.morts.length ? `, morts : ${issue.morts.map(m => `${m.nom} (manche ${m.manche})`).join(', ')}` : ''
      report.lignes.push(`  ${f.id} : ${p.nom}${created ? ' (placement inconnu, ajouté au registre)' : ''}, modificateur ${mod.nom}` +
        `${mules.length ? `, avec mule (${mules.join(', ')})` : ''} — ${issue.fin}, ` +
        `${issue.manches} manches, vague ${issue.vagues}${morts} ; ${r.tours} tours de Crâ, ${r.nouvelles} branche(s) nouvelle(s)` +
        `${r.remplace ? ' (combat déjà appris : remplacé)' : ''}`)
    }
  }
  if (!opts.dryRun) {
    if (regChanged) saveRegistry(reg, root)
    if (modsChanged) saveModifiers(mods, root)
    for (const lib of libs.values()) report.ecrits.push(saveLibrary(lib, root))
  }
  return report
}

export interface ReclassReport {
  lignes: string[]
  deplaces: number
  /** Combats laissés en place faute de connaître leurs monstres ou leur placement. */
  laisses: number
  ecrits: string[]
  /** Bibliothèques vidées d'un placement absent du registre (supprimées). */
  supprimes: string[]
}

/**
 * Range chaque combat appris dans la bibliothèque de son placement d'après le registre actuel (après une correction du
 * registre : placements déclarés, renommés, reconnaissance par espèce). Les monstres de départ d'un combat viennent de
 * sa fiche, sinon de son journal (data/fightlogs, relu une fois) : ils sont alors notés dans la fiche. Une bibliothèque
 * vidée dont le placement n'est plus dans le registre est supprimée. `dryRun` : rien n'est écrit.
 */
export function reclassify(opts: { root?: string; dryRun?: boolean } = {}): ReclassReport {
  const root = opts.root ?? process.cwd()
  const reg = loadRegistry(root)
  const dir = join(root, SCENARIOS_DIR)
  const libs = new Map<string, Library>()
  for (const f of existsSync(dir) ? readdirSync(dir).filter(x => x.endsWith('.json')).sort() : []) {
    const lib = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Library
    libs.set(lib.placement, lib)
  }
  const report: ReclassReport = { lignes: [], deplaces: 0, laisses: 0, ecrits: [], supprimes: [] }
  const changed = new Set<string>()
  const sessions = new Map<string, FightSource[]>()
  // Monstres d'un combat d'après son journal : ce combat, sinon (fiche sans rang) ceux de la session s'ils sont tous
  // du même placement.
  const fromLogs = (id: string): { espece: number; cellule: number }[] | undefined => {
    const file = id.split(/[# ]/)[0]
    const path = join(root, 'data', 'fightlogs', file)
    if (!existsSync(path)) return undefined
    let fights = sessions.get(file)
    if (!fights) {
      fights = fightsOfFile(path)
      sessions.set(file, fights)
    }
    const own = fights.find(f => f.id === id)?.scenario
    if (own) return monstersOf(own.monstres)
    const all = fights.flatMap(f => (f.scenario ? [monstersOf(f.scenario.monstres)] : []))
    return all.length && all.every(m => signature(m) === signature(all[0])) ? all[0] : undefined
  }
  for (const lib of [...libs.values()]) {
    for (const c of [...lib.combats]) {
      if (!c.monstres) {
        const m = fromLogs(c.id)
        if (!m) {
          report.laisses++
          report.lignes.push(`  ${c.id} : laissé dans « ${lib.placement} » (monstres inconnus : journal absent)`)
          continue
        }
        c.monstres = m
        changed.add(lib.placement)
      }
      const p = recognize(reg, c.monstres)
      if (!p) {
        report.laisses++
        report.lignes.push(`  ${c.id} : laissé dans « ${lib.placement} » (aucun placement du registre pour ${signature(c.monstres)})`)
        continue
      }
      if (p.nom === lib.placement) continue
      let to = libs.get(p.nom)
      if (!to) {
        to = loadLibrary(p.nom, root)
        libs.set(p.nom, to)
      }
      moveFight(lib, to, c.id)
      changed.add(lib.placement).add(p.nom)
      report.deplaces++
      report.lignes.push(`  ${c.id} : « ${lib.placement} » → « ${p.nom} »`)
    }
  }
  const known = new Set(reg.placements.map(p => p.nom))
  for (const nom of changed) {
    const lib = libs.get(nom)!
    if (!lib.combats.length && !known.has(nom)) {
      if (!opts.dryRun && existsSync(libraryPath(nom, root))) unlinkSync(libraryPath(nom, root))
      report.supprimes.push(nom)
    } else if (!opts.dryRun) report.ecrits.push(saveLibrary(lib, root))
  }
  return report
}
