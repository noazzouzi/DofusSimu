// Compilation du SCÉNARIO OPTIMAL d'un placement, à partir de sa bibliothèque (bibliotheque.ts) : pour chaque situation
// connue (Crâ, n-ième tour, case de départ, plateau), le meilleur tour joué depuis cette situation dans les combats
// appris. Le script de combat (ReineCombat.lua) joue ce tour tout de suite quand il retrouve la situation en jeu, sans
// attendre le serveur de plans ; une situation inconnue est laissée au serveur.
//
// Meilleur tour d'une situation, parmi ceux qui y ont été joués :
//   1. le moins souvent suivi d'une mort de Crâ dans la manche (un tour suivi d'une mort dans au moins la moitié des
//      combats où il a été joué est écarté : la situation revient au serveur) ;
//   2. le plus souvent gagnant (combats gagnés / combats où il a été joué, lissé : (gagnés + 1) / (joués + 2)) ;
//   3. le plus de dégâts en moyenne ;
//   4. le plus souvent joué, puis le plus récent.
// Écartés aussi : les tours sans aucune action (tour passé par AnkaBot) et ceux qui ne finissent pas sur la case de la
// colonne du Crâ.
//
// Correspondance plateau du jeu ↔ branche (`matchPlan`, reproduite à l'identique par le script Lua) : même case de
// départ, assez de PA et de PM, mêmes Crâs sur les mêmes cases, mêmes Bonbombes (celle du tour, qui apparaît au début du
// tour, peut manquer encore), autant de monstres de chaque espèce, chacun sur sa case (un monstre invisible dans la
// situation n'est pas comparé) — sauf un monstre loin de tous les Crâs (hors de portée de son prochain tour, pas visé
// par le tour), qui peut être ailleurs s'il y est loin aussi (TOLERANCE_LOIN au plus).
import { distance } from '../../../src/map/geometry'
import type { BoardEntry, Merged, MergedBranch, TurnPlan } from '../../fightlog/scenario'
import { SAFE } from '../planificateur/formation'
import { planOf, situationKey, type FightRecord, type Library, type LibraryBranch } from './bibliotheque'
import { casesOf, colonneOf, type PlacementDef, type Registry } from './placements'

const BOMB = 3725

/**
 * Distance (en cases) à partir de laquelle un monstre est « loin » d'un Crâ : une de plus que la distance de sécurité
 * mesurée (formation.ts, SAFE : plus longue attaque observée + 1). Doublure : aucune attaque relevée, mais elle pousse
 * (Subtilité) : 13 par prudence. Espèce absente (Bombe Illicale…) : jamais tolérée ailleurs.
 */
export const LOIN: Record<number, number> = { ...Object.fromEntries(Object.entries(SAFE).map(([k, v]) => [k, v + 1])), 3748: 13 }
/** Monstres lointains tolérés ailleurs que sur leur case enregistrée, au plus, pour qu'une branche corresponde. */
export const TOLERANCE_LOIN = 2

export interface CompileOptions {
  /** Combats appris avant cette date (ISO, « 2026-10-12 ») ignorés (sorts changés depuis…). */
  depuis?: string
  /** Taux de morts de Crâs dans la manche qui suit à partir duquel un tour est écarté (défaut 0,5). */
  mortsMax?: number
  /** Garder les tours sans action. */
  garderVides?: boolean
  /** Garder les tours qui ne finissent pas sur la case de la colonne. */
  garderHorsColonne?: boolean
  /** Combats laissés de côté (mesure de couverture : chaque combat contre les autres). */
  exclure?: ReadonlySet<string>
}

export interface CompiledPlacement extends Merged {
  stats: {
    combats: number
    victoires: number
    /** Situations connues (Crâ, tour, plateau) et branches retenues. */
    situations: number
    branches: number
    /** Branches écartées, par raison. */
    ecartees: Record<string, number>
  }
}

interface Ranked { b: LibraryBranch; n: number; v: number; morts: number; degats: number; last: string; fight: string }

/** Taux de victoire lissé (une victoire et une défaite fictives) : un seul combat gagné ne vaut pas 100 %. */
const rate = (x: Ranked) => (x.v + 1) / (x.n + 2)
/** Ordre des branches : la meilleure d'abord (voir l'en-tête). */
export function compareRanked(a: Ranked, b: Ranked): number {
  return (
    a.morts - b.morts ||
    rate(b) - rate(a) ||
    b.degats - a.degats ||
    b.n - a.n ||
    b.last.localeCompare(a.last)
  )
}

/** Monstres « loin » d'un tour enregistré (voir LOIN), espèces visées par le tour exceptées. */
export function markFar(plan: TurnPlan): BoardEntry[] {
  const targeted = new Set(plan.actions.flatMap(a => (a.type === 'sort' && a.espece ? [a.espece] : [])))
  const cras = [plan.depart, plan.fin, ...plan.plateau.filter(e => e.espece === 0).map(e => e.cellule)].filter(c => c >= 0)
  return plan.plateau.map(e => {
    const far = LOIN[e.espece]
    if (!far || e.invisible || targeted.has(e.espece) || e.cellule < 0) return e
    return cras.every(c => distance(c, e.cellule) >= far) ? { ...e, loin: true } : e
  })
}

/** Compile le scénario optimal d'un placement (format des scénarios de scenario.ts, pour le script Lua). */
export function compilePlacement(reg: Registry, p: PlacementDef, lib: Library, opts: CompileOptions = {}): CompiledPlacement {
  const mortsMax = opts.mortsMax ?? 0.5
  const colonne = colonneOf(reg, p)
  const fights = new Map<string, FightRecord>()
  for (const c of lib.combats) {
    if (opts.exclure?.has(c.id)) continue
    if (opts.depuis && (c.debut ?? '') < opts.depuis) continue
    fights.set(c.id, c)
  }
  const ecartees: Record<string, number> = {}
  const skip = (why: string) => {
    ecartees[why] = (ecartees[why] ?? 0) + 1
  }
  const groups = new Map<string, Ranked[]>()
  for (const b of lib.branches) {
    const occ = b.joue.filter(o => fights.has(o.combat))
    if (!occ.length) continue
    if (!b.actions.length && !opts.garderVides) {
      skip('tour sans action')
      continue
    }
    if (!opts.garderHorsColonne && colonne[b.perso] !== undefined && b.fin !== colonne[b.perso]) {
      skip('fin hors de la colonne')
      continue
    }
    const v = occ.filter(o => fights.get(o.combat)!.issue.fin === 'victoire').length
    const morts = occ.filter(o => o.morts.length > 0).length / occ.length
    if (morts >= mortsMax) {
      skip('suivi de morts de Crâs')
      continue
    }
    const latest = occ.map(o => fights.get(o.combat)!).sort((x, y) => (y.debut ?? y.id).localeCompare(x.debut ?? x.id))[0]
    const r: Ranked = { b, n: occ.length, v, morts, degats: occ.reduce((a, o) => a + o.degats, 0) / occ.length, last: latest.debut ?? latest.id, fight: latest.id }
    const key = situationKey(b)
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }
  // Une branche par situation : la meilleure ; puis, pour chaque tour de chaque Crâ, les situations dans l'ordre.
  const chosen = [...groups.values()].map(list => {
    list.sort(compareRanked)
    for (let i = 1; i < list.length; i++) skip('moins bon qu’un autre tour de la même situation')
    return list[0]
  })
  chosen.sort(compareRanked)
  const sourceIds = [...new Set(chosen.map(r => r.fight))].sort((a, b) => (fights.get(a)!.debut ?? a).localeCompare(fights.get(b)!.debut ?? b))
  const sourceOf = new Map(sourceIds.map((id, i) => [id, i + 1]))
  const ids = { ...reg.personnages }
  const names = new Map(Object.entries(ids).map(([n, id]) => [id, n]))
  const plans: Record<string, MergedBranch[][]> = {}
  for (const r of chosen) {
    const per = (plans[r.b.perso] ??= [])
    for (let k = per.length; k < r.b.tour; k++) per.push([])
    const plan = planOf(r.b, names)
    plan.plateau = markFar(plan)
    per[r.b.tour - 1].push({ source: sourceOf.get(r.fight)!, plan, combats: r.n, victoires: r.v, morts: r.morts, degats: Math.round(r.degats) })
  }
  const describe = (id: string) => {
    const c = fights.get(id)!
    const i = c.issue
    return `${id}${c.debut ? ` (${c.debut.slice(0, 16).replace('T', ' ')})` : ''} — ${i.fin}, ${i.manches} manches, vague ${i.vagues}`
  }
  return {
    nom: p.nom,
    carte: reg.carte,
    monstres: p.monstres.map(m => ({ espece: m.espece, cellule: m.cellule, nom: m.nom ?? `espèce ${m.espece}` })),
    cases: casesOf(reg, p),
    ids,
    colonne,
    sources: sourceIds.map(describe),
    plans,
    stats: {
      combats: fights.size,
      victoires: [...fights.values()].filter(c => c.issue.fin === 'victoire').length,
      situations: groups.size,
      branches: chosen.length,
      ecartees,
    },
  }
}

// ───────────────────────────── correspondance (miroir du script Lua) ─────────────────────────────

/** Plateau du jeu au début du tour d'un Crâ : sa case, ses PA/PM, les autres combattants vivants (case −1 : invisible). */
export interface GameBoard {
  moi: number
  pa?: number
  pm?: number
  entries: { e: number; id?: number; c: number }[]
}

export interface Match { ok: boolean; tolerated: number; reason?: string }

/** Plateau du jeu équivalent à un tour enregistré (les invisibles à −1, comme AnkaBot les donne). */
export function boardOf(plan: TurnPlan): GameBoard {
  return { moi: plan.depart, entries: plan.plateau.map(e => ({ e: e.espece, id: e.id, c: e.invisible ? -1 : e.cellule })) }
}

/** La branche correspond-elle au plateau du jeu ? (règles en tête du fichier ; même algorithme que le script Lua) */
export function matchPlan(plan: TurnPlan, game: GameBoard, maxTolerated = TOLERANCE_LOIN): Match {
  const fail = (reason: string): Match => ({ ok: false, tolerated: 0, reason })
  if (game.moi !== plan.depart) return fail(`départ ${game.moi} au lieu de ${plan.depart}`)
  if (game.pa !== undefined && plan.pa !== undefined && game.pa < plan.pa) return fail(`${game.pa} PA pour ${plan.pa}`)
  if (game.pm !== undefined && plan.pm !== undefined && game.pm < plan.pm) return fail(`${game.pm} PM pour ${plan.pm}`)
  // Crâs : les mêmes, sur les mêmes cases.
  const recCras = plan.plateau.filter(e => e.espece === 0)
  const gameCras = game.entries.filter(e => e.e === 0)
  if (recCras.length !== gameCras.length) return fail(`${gameCras.length} Crâs pour ${recCras.length}`)
  for (const r of recCras) if (!gameCras.some(g => g.id === r.id && g.c === r.cellule)) return fail(`Crâ ${r.nom} attendu en ${r.cellule}`)
  // Bonbombes : les mêmes cases ; celle du tour peut ne pas être encore apparue.
  const recBombs = plan.plateau.filter(e => e.espece === BOMB)
  const gameBombs = game.entries.filter(e => e.e === BOMB).map(e => e.c)
  for (const c of gameBombs) if (!recBombs.some(r => r.cellule === c)) return fail(`Bonbombe en ${c} inattendue`)
  for (const r of recBombs) if (!r.nouvelle && !gameBombs.includes(r.cellule)) return fail(`Bonbombe attendue en ${r.cellule}`)
  // Monstres : autant de chaque espèce ; chacun sur sa case, ou loin s'il était loin.
  const species = new Set([...plan.plateau.filter(e => e.espece !== 0 && e.espece !== BOMB).map(e => e.espece), ...game.entries.filter(e => e.e !== 0 && e.e !== BOMB).map(e => e.e)])
  const cras = [game.moi, plan.fin, ...gameCras.map(g => g.c)].filter(c => c >= 0)
  let tolerated = 0
  for (const sp of species) {
    const rec = plan.plateau.filter(e => e.espece === sp)
    const left = game.entries.filter(e => e.e === sp).map(e => e.c)
    if (rec.length !== left.length) return fail(`${left.length} ${rec[0]?.nom ?? `espèce ${sp}`} pour ${rec.length}`)
    const rest: BoardEntry[] = []
    for (const r of rec) {
      if (r.invisible) continue
      const k = left.indexOf(r.cellule)
      if (k >= 0) left.splice(k, 1)
      else rest.push(r)
    }
    // Invisible dans la situation : sa case n'est pas comparée (de préférence un monstre invisible en jeu, case −1).
    for (const r of rec) {
      if (!r.invisible) continue
      const k = left.includes(-1) ? left.indexOf(-1) : 0
      left.splice(k, 1)
    }
    for (const r of rest) {
      if (!r.loin) return fail(`${r.nom} attendu en ${r.invisible ? 'invisible' : r.cellule}`)
      const k = left.findIndex(c => c >= 0 && cras.every(x => distance(x, c) >= LOIN[sp]))
      if (k < 0) return fail(`${r.nom} attendu loin (en ${r.cellule})`)
      left.splice(k, 1)
      tolerated++
    }
  }
  if (tolerated > maxTolerated) return fail(`${tolerated} monstres lointains déplacés`)
  return { ok: true, tolerated }
}

/** Branche à jouer : celle qui correspond avec le moins de monstres lointains déplacés, à égalité la première. */
export function chooseBranch(branches: MergedBranch[], game: GameBoard, maxTolerated = TOLERANCE_LOIN): { branch?: MergedBranch; match?: Match } {
  let best: { branch: MergedBranch; match: Match } | undefined
  for (const b of branches) {
    const m = matchPlan(b.plan, game, maxTolerated)
    if (m.ok && (!best || m.tolerated < best.match.tolerated)) best = { branch: b, match: m }
    if (best?.match.tolerated === 0) break
  }
  return best ?? {}
}

// ───────────────────────────── couverture ─────────────────────────────

export interface Coverage {
  /** Tours de Crâ des combats mesurés, tours trouvés dans le scénario (plateau exact, ou monstres lointains déplacés). */
  tours: number
  exacts: number
  toleres: number
  /** Par combat : tours, tours couverts, manches couvertes d'affilée depuis le début (tous les Crâs). */
  parCombat: { id: string; issue: string; tours: number; couverts: number; manches: number }[]
}

/**
 * Couverture du scénario : chaque combat appris est rejoué contre le scénario compilé SANS lui (les autres combats) ;
 * un de ses tours est couvert si une branche correspond à son plateau. Estime la part des tours qu'un nouveau combat
 * jouerait sans le serveur.
 */
export function coverage(reg: Registry, p: PlacementDef, lib: Library, opts: CompileOptions = {}): Coverage {
  const out: Coverage = { tours: 0, exacts: 0, toleres: 0, parCombat: [] }
  for (const c of lib.combats) {
    if (opts.depuis && (c.debut ?? '') < opts.depuis) continue
    const compiled = compilePlacement(reg, p, lib, { ...opts, exclure: new Set([...(opts.exclure ?? []), c.id]) })
    const names = new Map(Object.entries(reg.personnages).map(([n, id]) => [id, n]))
    const turns = lib.branches.filter(b => b.joue.some(o => o.combat === c.id))
    const byRound = new Map<number, boolean>()
    let covered = 0
    for (const b of turns) {
      const plan = planOf(b, names)
      const res = chooseBranch(compiled.plans[b.perso]?.[b.tour - 1] ?? [], boardOf(plan))
      const ok = !!res.branch
      if (ok) {
        covered++
        if (res.match!.tolerated) out.toleres++
        else out.exacts++
      }
      byRound.set(b.manche, (byRound.get(b.manche) ?? true) && ok)
    }
    out.tours += turns.length
    let manches = 0
    for (let m = 1; byRound.get(m); m++) manches++
    out.parCombat.push({ id: c.id, issue: c.issue.fin, tours: turns.length, couverts: covered, manches })
  }
  return out
}
