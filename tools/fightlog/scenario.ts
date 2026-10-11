// Générateur du script AnkaBot de rejeu (tools/ankabot/ReineRejeu.lua) à partir de combats joués à la main et
// enregistrés par le journal (tools/ankabot/journal-combats.lua). Pour chaque combat source : placement des monstres
// (sa signature), case de départ de chaque Crâ, puis, pour chaque tour de chaque Crâ, ses déplacements et ses sorts
// dans l'ordre, avec la cible visée.
//   npx tsx tools/fightlog/scenario.ts --source "Placement 2=data/fightlogs/2026-10-10/session-08-29-54.jsonl"
//                                      [--source "Placement 3=…"] [--sortie tools/ankabot/ReineRejeu.lua]
// Sorts retenus : ceux que le Crâ a lui-même lancés (premier sort d'une séquence de type 0 ouverte par lui pendant son
// tour) ; les sorts déclenchés qui suivent dans la même séquence (Bleu Turquoise, rebonds, Péché Mignon…) sont écartés.
// Déplacements : ceux du Crâ pendant son tour (séquence de déplacement). Le combat est d'abord reconstitué et vérifié
// (rejeu.ts) : le générateur refuse une source dont la reconstitution ne colle pas aux synchronisations du serveur.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { cellToPoint } from '../../src/map/geometry'
import { data } from '../reine-des-voleurs/planificateur/etat'
import type { Row } from '../reine-des-voleurs/planificateur/journal'
import { fightRange, loadStream, MSG, rebuild } from './rejeu'

export type Step =
  | { type: 'deplacer'; cellule: number; chemin: number[]; etapes: number[] }
  | { type: 'sort'; sort: number; nom: string; cellule: number; depuis: number; cible: 'soi' | 'ennemi' | 'allie' | 'bombe' | 'case'; espece?: number; idCible?: number; nomCible?: string }

/**
 * Coins d'un chemin : cases où il change de direction, et la dernière. Entre deux coins le chemin est une ligne droite,
 * et le plus court chemin y est unique : un fightAction:moveToWardCell vers chaque coin refait le chemin enregistré case
 * pour case (le client du joueur contournait les marques posées sous les Crâs ; le plus court chemin d'AnkaBot, lui,
 * marche dessus et s'y arrête).
 */
export function corners(path: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < path.length; i++) {
    const a = cellToPoint(path[i - 1]), b = cellToPoint(path[i])
    const next = i + 1 < path.length ? cellToPoint(path[i + 1]) : undefined
    if (!next || next.x - b.x !== b.x - a.x || next.y - b.y !== b.y - a.y) out.push(path[i])
  }
  return out
}

/** Un combattant au début d'un tour : espèce (0 pour un Crâ, repéré alors par son identifiant), case, invisible. */
export interface BoardEntry { espece: number; id?: number; cellule: number; invisible?: boolean; nom: string }

export interface TurnPlan { manche: number; depart: number; fin: number; plateau: BoardEntry[]; actions: Step[] }

export interface Scenario {
  nom: string
  source: string
  carte: number
  /** Monstres au début du combat : espèce et case. */
  monstres: { espece: number; nom: string; cellule: number }[]
  /** Case de départ et identifiant de chaque Crâ. */
  cases: Record<string, number>
  ids: Record<string, number>
  plans: Record<string, TurnPlan[]>
  manches: number
  verification: string
}

const BOMB = 3725
const QUEEN = 3726
const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`

/**
 * `untilQueenDeath` : le scénario s'arrête au premier tour de Crâ qui commence après la mort de la Reine. ReineCombat
 * passe alors en mode avancé : les tours suivants ne seraient jamais rejoués, sauf, à tort, si la Reine vivait plus
 * longtemps qu'à l'enregistrement (tours visant les monstres des vagues suivantes, absents).
 */
export function extractScenario(name: string, file: string, perso?: string, opts: { untilQueenDeath?: boolean } = {}): Scenario {
  const { rows, character } = loadStream(file, perso)
  const res = rebuild(rows)
  if (res.checks.sync.bad > 0) throw new Error(`${file} : reconstitution fausse (${res.checks.sync.bad} écarts avec le serveur) — scénario refusé`)
  const { from, to } = fightRange(rows)
  const fight: Row[] = rows.slice(from, to).filter(r => r.k === 'm')
  const byGame = new Map(res.fighters.map(f => [f.gameId, f]))
  const start = (res.replay.events[0] as { t: 'fightStart'; fighters: { id: number; cell: number }[] }).fighters
  const players = res.fighters.filter(f => f.kind === 'player')
  const playerIds = new Set(players.map(f => f.gameId))

  // Cases des combattants au début et à la fin de chacun de leurs tours, et plateau (tous les autres combattants
  // vivants) au début de chaque tour de Crâ, d'après le replay reconstitué.
  const cell = new Map<number, number>(start.map(f => [res.fighters[f.id].gameId, f.cell]))
  const alive = new Set<number>(start.map(f => res.fighters[f.id].gameId))
  const invisible = new Set<number>()
  const turnCells = new Map<number, { depart: number; fin: number; plateau: BoardEntry[] }[]>()
  for (const e of res.replay.events) {
    const gid = (id: number) => res.fighters[id]?.gameId
    if (e.t === 'move') cell.set(gid(e.fighter), e.path[e.path.length - 1])
    else if (e.t === 'push' || e.t === 'teleport') cell.set(gid(e.target), e.to)
    else if (e.t === 'summon') {
      cell.set(gid(e.fighter.id), e.fighter.cell)
      alive.add(gid(e.fighter.id))
    } else if (e.t === 'wave') {
      for (const f of e.fighters) {
        cell.set(gid(f.id), f.cell)
        alive.add(gid(f.id))
      }
    } else if (e.t === 'death') alive.delete(gid(e.target))
    else if (e.t === 'state' && e.name === 'Invisible') {
      if (e.added) invisible.add(gid(e.target))
      else invisible.delete(gid(e.target))
    } else if (e.t === 'turnStart' && playerIds.has(gid(e.fighter))) {
      const me = gid(e.fighter)
      const plateau: BoardEntry[] = []
      for (const g of alive) {
        if (g === me) continue
        const f = byGame.get(g)!
        const entry: BoardEntry = { espece: f.kind === 'player' ? 0 : f.monsterId ?? 0, cellule: cell.get(g)!, nom: f.name.replace(/ -?\d+$/, '') }
        if (f.kind === 'player') entry.id = g
        if (invisible.has(g)) entry.invisible = true
        plateau.push(entry)
      }
      plateau.sort((a, b) => a.espece - b.espece || a.cellule - b.cellule)
      const list = turnCells.get(me) ?? []
      list.push({ depart: cell.get(me)!, fin: -1, plateau })
      turnCells.set(me, list)
    } else if (e.t === 'turnEnd' && playerIds.has(gid(e.fighter))) {
      const t = turnCells.get(gid(e.fighter))?.at(-1)
      if (t) t.fin = cell.get(gid(e.fighter))!
    }
  }

  const plans: Record<string, TurnPlan[]> = {}
  for (const p of players) plans[p.name] = []
  let round = 0
  let turnOf: number | undefined
  const stack: { type: number; author: number; casts: number }[] = []
  const turnIndex = new Map<number, number>()
  // Case du Crâ pendant son tour enregistré (départ, puis fin de chaque déplacement) : case d'où part chaque sort.
  let here = -1
  let queenDeath: number | undefined
  for (const r of fight) {
    const d = r.d ?? {}
    if (r.n === MSG.action && d.fwuz && byGame.get(d.fwuz.fwrl)?.monsterId === QUEEN) queenDeath ??= round
    if (r.n === MSG.round) round = d.fxjj
    else if (r.n === MSG.turnStart) {
      if (opts.untilQueenDeath && queenDeath !== undefined && byGame.get(d.fxjr)?.kind === 'player') break
      turnOf = d.fxjr
      const f = byGame.get(turnOf!)
      if (f?.kind === 'player') {
        const k = (turnIndex.get(f.gameId) ?? 0) + 1
        turnIndex.set(f.gameId, k)
        const cells = turnCells.get(f.gameId)?.[k - 1]
        plans[f.name].push({ manche: round, depart: cells?.depart ?? -1, fin: cells?.fin ?? -1, plateau: cells?.plateau ?? [], actions: [] })
        here = cells?.depart ?? -1
      }
    } else if (r.n === MSG.turnEnd) turnOf = undefined
    else if (r.n === 'jqh') stack.push({ type: d.fwji, author: d.fwjj, casts: 0 })
    else if (r.n === 'jsy') stack.pop()
    else if (r.n === MSG.move && turnOf !== undefined && d.fwaf === turnOf && playerIds.has(turnOf)) {
      const path: number[] = Array.isArray(d.fwab) ? d.fwab : []
      if (path.length > 1) {
        plans[byGame.get(turnOf)!.name].at(-1)!.actions.push({ type: 'deplacer', cellule: path[path.length - 1], chemin: path, etapes: corners(path) })
        here = path[path.length - 1]
      }
    } else if (r.n === MSG.action && d.fwuy) {
      const top = stack.at(-1)
      if (top) top.casts++
      if (turnOf === undefined || d.fwuw !== turnOf || !playerIds.has(turnOf) || top?.type !== 0 || top.author !== turnOf || top.casts !== 1) continue
      const c = d.fwuy
      const spell = c.fwqu?.fwpu ?? 0
      const target = byGame.get(c.fwqr)
      const me = byGame.get(turnOf)!
      const step: Step = { type: 'sort', sort: spell, nom: spellName(spell), cellule: c.fwqq, depuis: here, cible: 'case' }
      if (target && target.gameId === me.gameId) step.cible = 'soi'
      else if (target && target.monsterId === BOMB) Object.assign(step, { cible: 'bombe', espece: BOMB, idCible: target.gameId, nomCible: 'Bonbombe' })
      else if (target && target.team === me.team) Object.assign(step, { cible: 'allie', idCible: target.gameId, nomCible: target.name })
      else if (target) Object.assign(step, { cible: 'ennemi', espece: target.monsterId, idCible: target.gameId, nomCible: target.name.replace(/ -?\d+$/, '') })
      plans[me.name].at(-1)!.actions.push(step)
    }
  }

  // Combattants au début du combat : la case vient de l'instantané de départ (l'objet combattant porte l'état final).
  const s = start.map(f => ({ ...res.fighters[f.id], cell: f.cell }))
  return {
    nom: name,
    source: `${basename(join(file, '..'))}/${basename(file)} (flux de ${character})` +
      (opts.untilQueenDeath && queenDeath !== undefined ? `, jusqu'à la mort de la Reine` : ''),
    carte: 137101316,
    monstres: s.filter(f => f.team === 1).map(f => ({ espece: f.monsterId ?? 0, nom: f.name.replace(/ -?\d+$/, ''), cellule: f.cell })),
    cases: Object.fromEntries(s.filter(f => f.kind === 'player').map(f => [f.name, f.cell])),
    ids: Object.fromEntries(players.map(f => [f.name, f.gameId])),
    plans,
    manches: opts.untilQueenDeath && queenDeath !== undefined ? queenDeath : res.rounds,
    verification: `${res.checks.sync.ok}/${res.checks.sync.ok + res.checks.sync.bad} vérifications justes contre les synchronisations du serveur`,
  }
}

// ───────────────────────────── écriture Lua ─────────────────────────────

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function luaStep(a: Step): string {
  if (a.type === 'deplacer') return `{ type = "deplacer", cellule = ${a.cellule}, chemin = { ${a.chemin.join(', ')} }, etapes = { ${a.etapes.join(', ')} } }`
  const parts = [`type = "sort"`, `sort = ${a.sort}`, `cellule = ${a.cellule}`, `depuis = ${a.depuis}`, `cible = "${a.cible}"`]
  if (a.espece !== undefined) parts.push(`espece = ${a.espece}`)
  if (a.idCible !== undefined) parts.push(`id = ${a.idCible}`)
  return `{ ${parts.join(', ')} },  -- ${a.nom}${a.nomCible ? ` → ${a.nomCible}` : ''}`
}

/** Plusieurs combats d'un même placement : leurs tours deviennent des branches (variantes) du même tour. */
export interface Merged {
  nom: string
  carte: number
  monstres: Scenario['monstres']
  cases: Record<string, number>
  ids: Record<string, number>
  sources: string[]
  plans: Record<string, { source: number; plan: TurnPlan }[][]>
}

/** Colonne par défaut d'un placement : la case où chaque Crâ finit le plus souvent ses tours enregistrés. */
export function colonneOf(s: Merged): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [who, turns] of Object.entries(s.plans)) {
    const n = new Map<number, number>()
    for (const t of turns) for (const b of t) if (b.plan.fin >= 0) n.set(b.plan.fin, (n.get(b.plan.fin) ?? 0) + 1)
    const best = [...n].sort((a, b) => b[1] - a[1])[0]
    out[who] = best ? best[0] : s.cases[who]
  }
  return out
}

const placementKey = (m: { monstres: Scenario['monstres']; cases: Record<string, number> }) =>
  JSON.stringify([m.monstres.map(x => [x.espece, x.cellule]).sort(), Object.entries(m.cases).sort()])
const branchKey = (t: TurnPlan) => JSON.stringify([t.depart, t.plateau.map(b => [b.espece, b.id ?? 0, b.cellule, !!b.invisible]), t.actions])

export function mergeScenarios(list: Scenario[]): Merged[] {
  const out: Merged[] = []
  for (const s of list) {
    let m = out.find(x => x.nom === s.nom)
    if (m && placementKey(m) !== placementKey(s)) throw new Error(`« ${s.nom} » : ${s.source} n'a pas le même placement (monstres ou cases des Crâs) que les autres combats de ce nom`)
    if (!m) {
      m = { nom: s.nom, carte: s.carte, monstres: s.monstres, cases: s.cases, ids: s.ids, sources: [], plans: {} }
      out.push(m)
    }
    m.sources.push(`${s.source} — ${s.manches} manches ; ${s.verification}`)
    const src = m.sources.length
    for (const [who, turns] of Object.entries(s.plans)) {
      const per = (m.plans[who] ??= [])
      turns.forEach((t, k) => {
        const variants = (per[k] ??= [])
        // Branche déjà connue (même départ, même plateau, mêmes actions) : la source suivante n'ajoute rien.
        if (!variants.some(v => branchKey(v.plan) === branchKey(t))) variants.push({ source: src, plan: t })
      })
    }
  }
  return out
}

export function luaScenarios(list: Merged[]): string {
  const out: string[] = ['local SCENARIOS = {']
  for (const s of list) {
    out.push('  {')
    out.push(`    nom = ${q(s.nom)},`)
    out.push('    -- Combats enregistrés dont viennent les branches (n° de source).')
    out.push('    sources = {')
    s.sources.forEach((x, i) => out.push(`      [${i + 1}] = ${q(x)},`))
    out.push('    },')
    out.push(`    carte = ${s.carte},`)
    out.push('    -- Monstres au début du combat (espèce, case) : la signature du placement.')
    out.push('    monstres = {')
    for (const m of s.monstres) out.push(`      { espece = ${m.espece}, cellule = ${m.cellule} },  -- ${m.nom}`)
    out.push('    },')
    out.push('    -- Case de départ de chaque Crâ (placement imposé), et son identifiant de personnage.')
    out.push('    cases = {')
    for (const [n, c] of Object.entries(s.cases)) out.push(`      [${q(n)}] = ${c},`)
    out.push('    },')
    out.push('    ids = {')
    for (const [n, id] of Object.entries(s.ids)) out.push(`      [${q(n)}] = ${id},`)
    out.push('    },')
    out.push('    -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : une ou plusieurs branches, chacune avec le plateau')
    out.push('    -- relevé au début du tour dans son combat (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible alors, case')
    out.push('    -- non comparée). Le script joue la branche dont le plateau correspond à celui du jeu.')
    out.push('    plans = {')
    for (const [n, turns] of Object.entries(s.plans)) {
      out.push(`      [${q(n)}] = {`)
      turns.forEach((variants, i) => {
        out.push(`        [${i + 1}] = {`)
        for (const { source, plan: t } of variants) {
          out.push(`          { source = ${source}, manche = ${t.manche}, depart = ${t.depart}, fin = ${t.fin},`)
          const board = t.plateau.map(b => `{ e = ${b.espece}${b.id !== undefined ? `, id = ${b.id}` : ''}, c = ${b.cellule}${b.invisible ? ', inv = true' : ''} }`)
          out.push(`            plateau = { ${board.join(', ')} },`)
          out.push(`            -- ${t.plateau.map(b => `${b.nom}@${b.cellule}${b.invisible ? '(invisible)' : ''}`).join(' · ')}`)
          out.push('            actions = {')
          for (const a of t.actions) out.push(`              ${luaStep(a)}${a.type === 'deplacer' ? ',' : ''}`)
          out.push('            } },')
        }
        out.push('        },')
      })
      out.push('      },')
    }
    out.push('    },')
    out.push('  },')
  }
  out.push('}')
  return out.join('\n')
}

const MARK = '-- <<SCENARIOS>>'

/** Le script de rejeu (modele-rejeu.lua), scénarios écrits. */
export function rejeuPart(scenarios: Merged[], root = process.cwd(), by = 'tools/fightlog/scenario.ts'): string {
  const template = readFileSync(join(root, 'tools', 'fightlog', 'modele-rejeu.lua'), 'utf8')
  const k = template.indexOf(MARK)
  if (k < 0 || template.indexOf(MARK, k + 1) >= 0) throw new Error(`Le modèle doit contenir la ligne ${MARK} une seule fois`)
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const header = `-- Scénarios générés le ${stamp} par ${by} (${scenarios.map(s => `${s.nom} : ${s.sources.length} combat(s)`).join(' ; ')}).`
  return template.slice(0, k) + header + '\n' + luaScenarios(scenarios) + template.slice(k + MARK.length)
}

/** Résumé des scénarios (console). */
export function describeScenarios(scenarios: Merged[]): string[] {
  const out: string[] = []
  for (const s of scenarios) {
    const turns = Object.values(s.plans).reduce((a, t) => a + t.length, 0)
    const branches = Object.values(s.plans).reduce((a, t) => a + t.reduce((b, v) => b + v.length, 0), 0)
    out.push(`${s.nom} : ${s.sources.length} combat(s), ${turns} tours de Crâ, ${branches} branche(s)`)
    for (const x of s.sources) out.push(`  ${x}`)
  }
  return out
}

if (process.argv[1]?.endsWith('scenario.ts')) {
  const sources: [string, string][] = []
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] !== '--source') continue
    const [nom, ...rest] = process.argv[i + 1].split('=')
    sources.push([nom, rest.join('=')])
  }
  if (!sources.length) throw new Error('--source "Placement 2=data/fightlogs/…/session-….jsonl" attendu')
  const outIdx = process.argv.indexOf('--sortie')
  const out = outIdx > 0 ? process.argv[outIdx + 1] : join(process.cwd(), 'tools', 'ankabot', 'ReineRejeu.lua')
  const scenarios = mergeScenarios(sources.map(([nom, f]) => extractScenario(nom, f)))
  writeFileSync(out, rejeuPart(scenarios))
  for (const l of describeScenarios(scenarios)) console.log(l)
  console.log(`Écrit : ${out}`)
}
