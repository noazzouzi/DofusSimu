// Apprentissage : les combats d'une ou plusieurs sessions du journal (data/fightlogs/<jour>/session-<heure>.jsonl,
// écrits par le serveur de plans ou scripts/fightlog-server.mjs) ajoutés à la bibliothèque de leur placement.
//
// Chaque session contient les journaux des 4 Crâs et souvent plusieurs combats. Chaque combat est fusionné à part
// (tools/fightlog/fusion.ts : pendant son tour, le script d'un Crâ qui joue n'enregistre rien, les autres oui), puis
// reconstitué et vérifié contre les synchronisations du serveur (tools/fightlog/rejeu.ts), et ses tours de Crâ extraits
// (tools/fightlog/scenario.ts). Le placement est reconnu par les cases des monstres au début du combat ; inconnu, il est
// ajouté au registre (« Auto … »).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fightsOf, mergeStreams, type Stream } from '../../fightlog/fusion'
import { scenarioFromRows, type Scenario } from '../../fightlog/scenario'
import { chainsOf } from '../planificateur/journal'
import { addFight, loadLibrary, saveLibrary, type Library } from './bibliotheque'
import { autoPlacement, loadRegistry, recognize, saveRegistry, type Registry } from './placements'

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
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
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

export interface LearnReport {
  lignes: string[]
  appris: number
  ignores: number
  /** Placements créés (monstres inconnus). */
  nouveaux: string[]
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
  const libs = new Map<string, Library>()
  const report: LearnReport = { lignes: [], appris: 0, ignores: 0, nouveaux: [], ecrits: [] }
  const files = sessionFiles(paths)
  if (!files.length) report.lignes.push(`aucune session (session-*.jsonl) sous ${paths.join(', ')}`)
  let regChanged = false
  for (const file of files) {
    report.lignes.push(`${relative(root, file) || file}`)
    for (const f of fightsOfFile(file)) {
      if (!f.scenario) {
        report.ignores++
        report.lignes.push(`  ${f.id} : ignoré — ${f.ignore}`)
        continue
      }
      const sc = f.scenario
      let p = recognize(reg, sc.monstres)
      const created = !p
      if (!p) {
        const fins: Record<string, number[]> = {}
        for (const [who, turns] of Object.entries(sc.plans)) fins[who] = turns.map(t => t.fin)
        p = autoPlacement(sc.monstres.map(m => ({ espece: m.espece, cellule: m.cellule, nom: m.nom })), sc.cases, fins)
        reg.placements.push(p)
        report.nouveaux.push(p.nom)
        regChanged = true
      }
      for (const [who, id] of Object.entries(sc.ids)) {
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
      const r = addFight(lib, f.id, sc)
      report.appris++
      const issue = sc.issue!
      const morts = issue.morts.length ? `, morts : ${issue.morts.map(m => `${m.nom} (manche ${m.manche})`).join(', ')}` : ''
      report.lignes.push(`  ${f.id} : ${p.nom}${created ? ' (placement inconnu, ajouté au registre)' : ''} — ${issue.fin}, ` +
        `${issue.manches} manches, vague ${issue.vagues}${morts} ; ${r.tours} tours de Crâ, ${r.nouvelles} branche(s) nouvelle(s)` +
        `${r.remplace ? ' (combat déjà appris : remplacé)' : ''}`)
    }
  }
  if (!opts.dryRun) {
    if (regChanged) saveRegistry(reg, root)
    for (const lib of libs.values()) report.ecrits.push(saveLibrary(lib, root))
  }
  return report
}
