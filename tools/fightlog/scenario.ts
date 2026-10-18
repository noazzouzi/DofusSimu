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

/**
 * Un combattant au début d'un tour : espèce (0 pour un Crâ, repéré alors par son identifiant), case, invisible.
 * `nouvelle` : Bonbombe du Crâ qui joue, apparue au début de ce tour (le script peut commencer son tour avant de la voir).
 */
export interface BoardEntry {
  espece: number
  id?: number
  cellule: number
  invisible?: boolean
  nouvelle?: boolean
  nom: string
  /**
   * Monstre loin de tous les Crâs (hors de portée de son prochain tour, et pas visé par le tour) : le script tolère qu'il
   * soit ailleurs, s'il y est loin aussi (compilation des scénarios, tools/reine-des-voleurs/scenarios).
   */
  loin?: boolean
}

export interface TurnPlan {
  manche: number
  depart: number
  fin: number
  /**
   * Plateau (tous les autres combattants vivants) au moment où le Crâ commence à jouer : juste avant sa première action
   * (sa bombe du tour apparue, effets de début de tour passés), ou à la fin du tour s'il n'a rien fait.
   */
  plateau: BoardEntry[]
  actions: Step[]
  /** PA et PM dépensés pendant le tour (PA utilisés d'après le serveur, PM des déplacements). */
  pa?: number
  pm?: number
  /** Dégâts infligés aux monstres pendant le tour (sorts et effets déclenchés). */
  degats?: number
  /** Crâs morts entre le début de ce tour et le début du tour suivant de ce Crâ (ou la fin du combat). */
  morts?: string[]
}

/** Issue d'un combat d'après le journal. */
export interface Issue {
  /**
   * victoire : fin de combat, plus aucun monstre en vie ; abandon : fin de combat, des monstres et un Crâ en vie ;
   * defaite : fin de combat, aucun Crâ en vie ; interrompu : le journal s'arrête avant la fin du combat.
   */
  fin: 'victoire' | 'defaite' | 'abandon' | 'interrompu'
  manches: number
  /** Vagues vues (1 à 5). */
  vagues: number
  morts: { nom: string; manche: number }[]
}

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
  issue?: Issue
  /** Heure du début du combat (lot du journal qui porte la manche 1), si connue. */
  debut?: string
  /**
   * Sorts lancés au début du combat, avant le premier tour : passifs des Crâs, mécaniques du donjon et modificateur de
   * dimension (tools/reine-des-voleurs/scenarios/modificateurs.ts).
   */
  sortsDebut?: number[]
  /** Sorts du début du combat lancés par chaque joueur (par nom), et par les monstres : le modificateur s'en déduit. */
  sortsDebutJoueurs?: Record<string, number[]>
  sortsDebutMonstres?: number[]
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
  return scenarioFromRows(name, rows, `${basename(join(file, '..'))}/${basename(file)} (flux de ${character})`, opts)
}

/**
 * Scénario d'un combat d'après les lignes du journal (un flux, ou les journaux des 4 Crâs fusionnés : fusion.ts) : le
 * dernier combat de ces lignes, ou le `which`-ième. Le combat est d'abord reconstitué et vérifié (rejeu.ts) : refusé si
 * la reconstitution ne colle pas aux synchronisations du serveur.
 */
export function scenarioFromRows(name: string, rows: Row[], source: string, opts: { untilQueenDeath?: boolean; which?: number } = {}): Scenario {
  const which = opts.which ?? -1
  const res = rebuild(rows, { which })
  if (res.checks.sync.bad > 0) throw new Error(`${source} : reconstitution fausse (${res.checks.sync.bad} écarts avec le serveur) — scénario refusé`)
  const { from, to } = fightRange(rows, which)
  const fight: Row[] = rows.slice(from, to).filter(r => r.k === 'm')
  const byGame = new Map(res.fighters.map(f => [f.gameId, f]))
  const ev = res.replay.events
  const firstTurn = ev.findIndex(e => e.t === 'turnStart')
  const debut = ev.slice(0, firstTurn < 0 ? ev.length : firstTurn).flatMap(e => (e.t === 'cast' ? [e] : []))
  const sortsDebut = [...new Set(debut.map(e => e.spellId))].sort((a, b) => a - b)
  const sortsDebutJoueurs: Record<string, number[]> = {}
  const monstres = new Set<number>()
  for (const e of debut) {
    const f = res.fighters[e.fighter]
    if (f?.kind !== 'player') {
      if (f?.team === 1) monstres.add(e.spellId)
      continue
    }
    const l = (sortsDebutJoueurs[f.name] ??= [])
    if (!l.includes(e.spellId)) l.push(e.spellId)
  }
  const sortsDebutMonstres = [...monstres].sort((a, b) => a - b)
  const start = (ev[0] as { t: 'fightStart'; fighters: { id: number; cell: number }[] }).fighters
  const players = res.fighters.filter(f => f.kind === 'player')
  const playerIds = new Set(players.map(f => f.gameId))
  const gid = (id: number) => res.fighters[id]?.gameId

  // Plateau de chaque tour de Crâ (au moment où il commence à jouer), PA/PM dépensés, dégâts, d'après le replay
  // reconstitué ; morts des Crâs et des monstres, vagues.
  const cell = new Map<number, number>(start.map(f => [gid(f.id), f.cell]))
  const alive = new Set<number>(start.map(f => gid(f.id)))
  const invisible = new Set<number>()
  /** Bombes : poseur (identifiant de jeu) et manche d'apparition. */
  const bombs = new Map<number, { owner: number; born: number }>()
  interface TurnInfo { depart: number; fin: number; plateau: BoardEntry[]; pa: number; pm: number; degats: number; ev: number; captured: boolean }
  const turnCells = new Map<number, TurnInfo[]>()
  const deaths: { gid: number; ev: number; round: number }[] = []
  let round = 0
  let waves = 1
  let current: number | undefined
  let ended = false
  const capture = (me: number, t: TurnInfo) => {
    const plateau: BoardEntry[] = []
    for (const g of alive) {
      if (g === me) continue
      const f = byGame.get(g)!
      const entry: BoardEntry = { espece: f.kind === 'player' ? 0 : f.monsterId ?? 0, cellule: cell.get(g)!, nom: f.name.replace(/ -?\d+$/, '') }
      if (f.kind === 'player') entry.id = g
      if (invisible.has(g)) entry.invisible = true
      const b = bombs.get(g)
      if (b && b.owner === me && b.born === round) entry.nouvelle = true
      plateau.push(entry)
    }
    plateau.sort((a, b) => a.espece - b.espece || a.cellule - b.cellule)
    Object.assign(t, { plateau, depart: cell.get(me)!, captured: true })
  }
  ev.forEach((e, idx) => {
    const turn = current !== undefined ? turnCells.get(current)?.at(-1) : undefined
    const mine = (id: number) => current !== undefined && gid(id) === current
    // Première action volontaire du Crâ : le plateau est relevé juste avant.
    if (turn && !turn.captured && ((e.t === 'move' && mine(e.fighter)) || (e.t === 'cast' && mine(e.fighter) && res.voluntary.has(idx)))) capture(current!, turn)
    if (e.t === 'roundStart') round = e.round
    else if (e.t === 'move') {
      cell.set(gid(e.fighter), e.path[e.path.length - 1])
      if (turn && mine(e.fighter)) turn.pm += e.mpUsed
    } else if (e.t === 'push' || e.t === 'teleport') cell.set(gid(e.target), e.to)
    else if (e.t === 'summon') {
      const g = gid(e.fighter.id)
      cell.set(g, e.fighter.cell)
      alive.add(g)
      if (byGame.get(g)?.monsterId === BOMB) bombs.set(g, { owner: gid(e.summoner), born: round })
    } else if (e.t === 'wave') {
      waves = Math.max(waves, e.index)
      for (const f of e.fighters) {
        cell.set(gid(f.id), f.cell)
        alive.add(gid(f.id))
      }
    } else if (e.t === 'death') {
      const g = gid(e.target)
      if (alive.has(g) && playerIds.has(g)) deaths.push({ gid: g, ev: idx, round })
      alive.delete(g)
    } else if (e.t === 'state' && e.name === 'Invisible') {
      if (e.added) invisible.add(gid(e.target))
      else invisible.delete(gid(e.target))
    } else if (e.t === 'apmp' && turn && mine(e.target) && e.reason === 'utilisés' && e.ap < 0) turn.pa -= e.ap
    else if (e.t === 'damage' && turn && e.amount > 0) {
      const t = res.fighters[e.target]
      if (t && t.team === 1 && t.monsterId !== BOMB) turn.degats += e.amount
    } else if (e.t === 'turnStart') {
      current = playerIds.has(gid(e.fighter)) ? gid(e.fighter) : undefined
      if (current !== undefined) {
        const list = turnCells.get(current) ?? []
        list.push({ depart: cell.get(current)!, fin: -1, plateau: [], pa: 0, pm: 0, degats: 0, ev: idx, captured: false })
        turnCells.set(current, list)
      }
    } else if (e.t === 'turnEnd' && playerIds.has(gid(e.fighter))) {
      const t = turnCells.get(gid(e.fighter))?.at(-1)
      if (t) {
        if (!t.captured) capture(gid(e.fighter), t)
        t.fin = cell.get(gid(e.fighter))!
      }
      current = undefined
    } else if (e.t === 'fightEnd') ended = e.reason === 'fin de combat (journal)'
  })
  // Morts de Crâs entre le début de chaque tour de Crâ et le début de son tour suivant.
  for (const list of turnCells.values()) {
    list.forEach((t, k) => {
      const next = list[k + 1]?.ev ?? Infinity
      ;(t as TurnInfo & { morts?: string[] }).morts = deaths.filter(d => d.ev >= t.ev && d.ev < next).map(d => byGame.get(d.gid)!.name)
    })
  }

  const plans: Record<string, TurnPlan[]> = {}
  for (const p of players) plans[p.name] = []
  round = 0
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
        const t = turnCells.get(f.gameId)?.[k - 1] as (TurnInfo & { morts?: string[] }) | undefined
        const plan: TurnPlan = { manche: round, depart: t?.depart ?? -1, fin: t?.fin ?? -1, plateau: t?.plateau ?? [], actions: [] }
        if (t) Object.assign(plan, { pa: t.pa, pm: t.pm, degats: t.degats, morts: t.morts ?? [] })
        plans[f.name].push(plan)
        here = plan.depart
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

  // Issue : fin de combat du journal ; plus aucun monstre (hors invocations) en vie : victoire.
  const monstersLeft = [...alive].some(g => {
    const f = byGame.get(g)
    return f?.team === 1 && f.kind === 'monster'
  })
  const crasLeft = [...alive].some(g => playerIds.has(g))
  const issue: Issue = {
    fin: !ended ? 'interrompu' : !monstersLeft ? 'victoire' : crasLeft ? 'abandon' : 'defaite',
    manches: res.rounds,
    vagues: waves,
    morts: deaths.map(d => ({ nom: byGame.get(d.gid)!.name, manche: d.round })),
  }
  const firstRow = rows[from]
  // Combattants au début du combat : la case vient de l'instantané de départ (l'objet combattant porte l'état final).
  const s = start.map(f => ({ ...res.fighters[f.id], cell: f.cell }))
  return {
    nom: name,
    source: source + (opts.untilQueenDeath && queenDeath !== undefined ? `, jusqu'à la mort de la Reine` : ''),
    carte: 137101316,
    monstres: s.filter(f => f.team === 1).map(f => ({ espece: f.monsterId ?? 0, nom: f.name.replace(/ -?\d+$/, ''), cellule: f.cell })),
    cases: Object.fromEntries(s.filter(f => f.kind === 'player').map(f => [f.name, f.cell])),
    ids: Object.fromEntries(players.map(f => [f.name, f.gameId])),
    plans,
    manches: opts.untilQueenDeath && queenDeath !== undefined ? queenDeath : res.rounds,
    verification: `${res.checks.sync.ok}/${res.checks.sync.ok + res.checks.sync.bad} vérifications justes contre les synchronisations du serveur`,
    issue,
    debut: firstRow?.at || undefined,
    sortsDebut,
    sortsDebutJoueurs,
    sortsDebutMonstres,
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

/** Une branche d'un tour : le tour enregistré, son combat source (n°), et ce qu'en dit la bibliothèque. */
export interface MergedBranch {
  source: number
  plan: TurnPlan
  /** Combats où ce tour a été joué depuis ce plateau, dont gagnés ; taux de Crâs morts dans la manche qui a suivi. */
  combats?: number
  victoires?: number
  morts?: number
  /** Dégâts moyens du tour. */
  degats?: number
}

/** Plusieurs combats d'un même placement : leurs tours deviennent des branches (variantes) du même tour. */
export interface Merged {
  nom: string
  carte: number
  monstres: Scenario['monstres']
  cases: Record<string, number>
  ids: Record<string, number>
  sources: string[]
  /** Branches de chaque tour de chaque Crâ, la meilleure d'abord (le script prend la première qui correspond). */
  plans: Record<string, MergedBranch[][]>
  /** Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour). */
  colonne?: Record<string, number>
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

/**
 * Les scénarios en Lua (table SCENARIOS du modèle de rejeu). `loin` : distance à partir de laquelle un monstre est loin
 * d'un Crâ, par espèce (table LOIN du script, compilation des scénarios). Chaque scénario et chaque tour de Crâ est écrit
 * dans un bloc à part (tables de taille raisonnable pour l'interpréteur d'AnkaBot).
 */
export function luaScenarios(list: Merged[], opts: { loin?: Record<number, number> } = {}): string {
  const out: string[] = []
  if (opts.loin) {
    out.push('-- Distance (en cases) à partir de laquelle un monstre est loin d\'un Crâ, par espèce : hors de portée de son prochain')
    out.push('-- tour (tools/reine-des-voleurs/scenarios/compilation.ts, LOIN).')
    out.push(`LOIN = { ${Object.entries(opts.loin).map(([e, d]) => `[${e}] = ${d}`).join(', ')} }`)
  }
  out.push('local SCENARIOS = {}')
  for (const s of list) {
    out.push('do')
    out.push('  local S = {')
    out.push(`    nom = ${q(s.nom)},`)
    out.push('    -- Combats appris dont viennent les situations (n° de source).')
    out.push('    sources = {')
    s.sources.forEach((x, i) => out.push(`      [${i + 1}] = ${q(x)},`))
    out.push('    },')
    out.push(`    carte = ${s.carte},`)
    out.push('    -- Monstres au début du combat (espèce, case) : la signature du placement.')
    out.push('    monstres = {')
    for (const m of s.monstres) out.push(`      { espece = ${m.espece}, cellule = ${m.cellule} },  -- ${m.nom}`)
    out.push('    },')
    out.push('    -- Case de placement de chaque Crâ, et son identifiant de personnage.')
    out.push('    cases = {')
    for (const [n, c] of Object.entries(s.cases)) out.push(`      [${q(n)}] = ${c},`)
    out.push('    },')
    if (s.colonne) {
      out.push('    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).')
      out.push('    colonne = {')
      for (const [n, c] of Object.entries(s.colonne)) out.push(`      [${q(n)}] = ${c},`)
      out.push('    },')
    }
    out.push('    ids = {')
    for (const [n, id] of Object.entries(s.ids)) out.push(`      [${q(n)}] = ${id},`)
    out.push('    },')
    out.push('    plans = {},')
    out.push('  }')
    out.push('  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d\'abord, chacune avec')
    out.push('  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =')
    out.push('  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s\'il y est loin aussi), les PA')
    out.push('  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.')
    for (const [n, turns] of Object.entries(s.plans)) {
      out.push(`  S.plans[${q(n)}] = {}`)
      turns.forEach((variants, i) => {
        if (!variants.length) return
        out.push(`  S.plans[${q(n)}][${i + 1}] = {`)
        for (const v of variants) {
          const t = v.plan
          const head = [`source = ${v.source}`, `manche = ${t.manche}`, `depart = ${t.depart}`, `fin = ${t.fin}`]
          if (t.pa !== undefined) head.push(`pa = ${t.pa}`)
          if (t.pm !== undefined) head.push(`pm = ${t.pm}`)
          if (v.combats !== undefined) head.push(`combats = ${v.combats}`, `victoires = ${v.victoires ?? 0}`)
          out.push(`    { ${head.join(', ')},`)
          const board = t.plateau.map(b => `{ e = ${b.espece}${b.id !== undefined ? `, id = ${b.id}` : ''}, c = ${b.cellule}` +
            `${b.invisible ? ', inv = true' : ''}${b.nouvelle ? ', n = true' : ''}${b.loin ? ', l = true' : ''} }`)
          out.push(`      plateau = { ${board.join(', ')} },`)
          out.push(`      -- ${t.plateau.map(b => `${b.nom}@${b.cellule}${b.invisible ? '(invisible)' : ''}${b.nouvelle ? '(du tour)' : ''}${b.loin ? '(loin)' : ''}`).join(' · ')}` +
            (v.combats !== undefined ? ` — ${v.combats} combat(s), ${v.victoires ?? 0} gagné(s), ${v.degats ?? 0} dégâts en moyenne` : ''))
          out.push('      actions = {')
          for (const a of t.actions) out.push(`        ${luaStep(a)}${a.type === 'deplacer' ? ',' : ''}`)
          out.push('      } },')
        }
        out.push('  }')
      })
    }
    out.push('  SCENARIOS[#SCENARIOS + 1] = S')
    out.push('end')
  }
  return out.join('\n')
}

const MARK = '-- <<SCENARIOS>>'

/** Le script de rejeu (modele-rejeu.lua), scénarios écrits. */
export function rejeuPart(scenarios: Merged[], root = process.cwd(), by = 'tools/fightlog/scenario.ts', opts: { loin?: Record<number, number> } = {}): string {
  const template = readFileSync(join(root, 'tools', 'fightlog', 'modele-rejeu.lua'), 'utf8')
  const k = template.indexOf(MARK)
  if (k < 0 || template.indexOf(MARK, k + 1) >= 0) throw new Error(`Le modèle doit contenir la ligne ${MARK} une seule fois`)
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const header = `-- Scénarios générés le ${stamp} par ${by} (${scenarios.map(s => `${s.nom} : ${s.sources.length} combat(s)`).join(' ; ')}).`
  return template.slice(0, k) + header + '\n' + luaScenarios(scenarios, opts) + template.slice(k + MARK.length)
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
