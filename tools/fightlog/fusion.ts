// Fusion des journaux des personnages d'un groupe (tools/ankabot/journal-combats.lua, une instance par personnage).
//
// Pourquoi : AnkaBot ne laisse entrer qu'un fil d'exécution à la fois dans un script ; quand le script d'un personnage
// est occupé (son propre tour, joué par le script d'IA, ou la demande de son plan au serveur), les messages qui lui
// arrivent sont perdus pour SON journal. Les autres personnages, qui ne jouent pas, reçoivent les mêmes messages de
// combat : chaque tour est donc pris dans le journal d'un personnage qui n'est pas celui qui joue.
//
// Découpage : par début de tour (jvj, combattant fxjr), repéré dans chaque journal par (manche, combattant, rang de ce
// combattant dans la manche) ; prologue (placement, synchronisation) et découpage de référence : le journal qui a le
// plus de tours (à égalité, le premier de `prefer`).
import { fightRange, MSG } from './rejeu'
import type { Row } from '../reine-des-voleurs/planificateur/journal'

export interface Stream { name: string; rows: Row[] }

interface Segment { key: string; fighter: number; rows: Row[]; round: number; next?: string }

/** Joueurs du combat (identifiant de jeu → nom), d'après la première synchronisation complète (juo). */
export function playerNames(rows: Row[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const r of rows) {
    if (r.k !== 'm' || r.n !== MSG.sync) continue
    for (const e of Array.isArray(r.d?.fxgj) ? r.d.fxgj : []) {
      const name = e?.gcay?.gcar?.gcah?.gbyn
      if (typeof name === 'string' && typeof e.gcaw === 'number') out.set(e.gcaw, name)
    }
    if (out.size) break
  }
  return out
}

/** `roundNext` : pour chaque début de manche, le tour qui le suit dans ce journal. */
interface Cut { prologue: Row[]; segs: Segment[]; rounds: Map<number, Row[]>; roundNext: Map<number, string>; end?: Row }

/**
 * Découpage d'un journal en tours. Les débuts de manche (jvi, avec les messages qui le suivent jusqu'au premier tour :
 * arrivée d'une vague…) et la fin du combat (jwh) sont mis à part : un journal qui se tait pendant le tour de son
 * personnage et celui d'avant (QUIET_AROUND_MY_TURN) les reçoit après un silence et les accrocherait au mauvais tour ;
 * la fusion les remet à leur place. Manche manquée pendant un silence (le personnage joue le premier de la manche) :
 * déduite, un combattant ne jouant qu'une fois par manche.
 */
function segments(rows: Row[]): Cut {
  const prologue: Row[] = []
  const segs: Segment[] = []
  const rounds = new Map<number, Row[]>()
  const roundNext = new Map<number, string>()
  let end: Row | undefined
  let round = 0
  let block: Row[] | null = null
  const seen = new Map<string, number>()
  const played = new Set<number>()
  for (const r of rows) {
    if (r.k === 'm' && r.n === MSG.round && typeof r.d?.fxjj === 'number') {
      round = r.d.fxjj
      played.clear()
      if (segs.length) {
        block = [r]
        if (!rounds.has(round)) rounds.set(round, block)
        continue
      }
    }
    if (r.k === 'm' && r.n === MSG.end) {
      end ??= r
      continue
    }
    if (r.k === 'm' && r.n === MSG.turnStart && typeof r.d?.fxjr === 'number') {
      const afterRound = block !== null && rounds.get(round) === block
      block = null
      // Même combattant que le tour précédent : début de tour en double (deux instances du script), pas un nouveau tour
      // (entre deux tours d'un combattant, d'autres jouent toujours, hors du silence de ce journal).
      if (segs.length && segs[segs.length - 1].fighter === r.d.fxjr) {
        segs[segs.length - 1].rows.push(r)
        continue
      }
      if (played.has(r.d.fxjr)) {
        round++
        played.clear()
      }
      played.add(r.d.fxjr)
      const base = `${round}:${r.d.fxjr}`
      const occ = (seen.get(base) ?? 0) + 1
      seen.set(base, occ)
      if (segs.length) segs[segs.length - 1].next = `${base}:${occ}`
      if (afterRound) roundNext.set(round, `${base}:${occ}`)
      segs.push({ key: `${base}:${occ}`, fighter: r.d.fxjr, rows: [r], round })
      continue
    }
    if (block) block.push(r)
    else if (segs.length) segs[segs.length - 1].rows.push(r)
    else prologue.push(r)
  }
  return { prologue, segs, rounds, roundNext, end }
}

/** Écart toléré entre les débuts (manche 1) d'un même combat vus par deux journaux, en ms d'horloge des scripts. */
const SAME_FIGHT_MS = 60000
/**
 * Débuts de manche 1 de plusieurs journaux séparés de moins de cet écart (ms) : le même combat (les scripts d'un groupe
 * ont la même horloge et reçoivent ce message presque ensemble ; deux combats se suivent à plus d'une minute).
 */
const CLUSTER_MS = 20000

export interface MergeOptions {
  /** Combat à fusionner : heure (ms d'horloge des scripts) de son début ; défaut : le dernier combat. */
  at?: number
  /**
   * Combat à fusionner par son rang (journaux sans heures) : seuls les journaux qui ont vu le plus de débuts de combat
   * sont pris, alignés rang pour rang.
   */
  index?: number
}

/** Débuts de combat (manche 1) d'un journal : rang (pour fightRange) et heure (ms de l'horloge du script, si notée). */
function round1Starts(rows: Row[]): { k: number; ms: number | undefined }[] {
  const out: { k: number; ms: number | undefined }[] = []
  for (const r of rows) {
    if (r.k === 'm' && r.n === MSG.round && r.d?.fxjj === 1) out.push({ k: out.length, ms: typeof r.ms === 'number' ? r.ms : undefined })
  }
  return out
}

/**
 * Lignes du dernier combat (ou de celui que désigne `opts` : `fightsOf`), chaque tour pris dans le journal d'un
 * personnage qui ne joue pas ce tour-là (de préférence un journal qui a aussi vu le tour suivant, puis le plus complet ;
 * à égalité, dans l'ordre de `prefer`) ; à défaut, le journal de référence.
 *
 * Dernier combat : le début (manche 1) le plus récent, tous journaux confondus (les scripts d'un groupe tournent dans le
 * même AnkaBot : même horloge). Un journal qui n'a pas ce début (script occupé à ce moment-là) est laissé de côté au
 * lieu de mêler son combat précédent au combat en cours — 2026-10-11 à 18:32 : journal de Lamouit sans la manche 1,
 * son combat précédent, plus long, pris comme référence ; plans faits sur un état périmé, combat perdu. Sans heures, ou
 * si un seul journal a ce début : le dernier combat de chaque journal (comme avant).
 */
export function mergeStreams(streams: Stream[], prefer: string[] = [], opts: MergeOptions = {}): { rows: Row[]; sources: Record<string, number> } {
  const names = new Map<number, string>()
  const starts = streams.map(s => round1Starts(s.rows))
  const lastMs = starts.map(l => l.at(-1)?.ms).filter((x): x is number => x !== undefined)
  const latest = opts.at ?? (lastMs.length ? Math.max(...lastMs) : undefined)
  const near = (x: { ms: number | undefined }) => latest !== undefined && x.ms !== undefined && Math.abs(x.ms - latest) <= SAME_FIGHT_MS
  const aligned = opts.at !== undefined || starts.filter(l => l.some(near)).length >= 2
  const most = Math.max(0, ...starts.map(l => l.length))
  /** Rang du combat en cours dans ce journal (-1 : son dernier), ou null s'il ne l'a pas. */
  const which = (i: number): number | null => {
    // (combat donné par son rang : seulement les journaux qui ont vu tous les combats, alignés rang pour rang)
    if (opts.index !== undefined) return starts[i].length === most ? opts.index : null
    if (!aligned) return -1
    let best: { k: number; d: number } | null = null
    for (const x of starts[i]) if (near(x) && (!best || Math.abs(x.ms! - latest!) < best.d)) best = { k: x.k, d: Math.abs(x.ms! - latest!) }
    return best ? best.k : null
  }
  const cut = streams
    .map((s, i) => {
      try {
        const w = which(i)
        if (w === null) return null
        const { from, to } = fightRange(s.rows, w)
        // Noms des joueurs : synchronisation du placement (avant la manche 1) ou du début du combat.
        for (const [id, n] of playerNames(s.rows.slice(Math.max(0, from - 20000), to))) names.set(id, n)
        return { name: s.name, ...segments(s.rows.slice(from, to)) }
      } catch {
        return null
      }
    })
    .filter((x): x is { name: string } & Cut => x !== null)
  if (!cut.length) return { rows: [], sources: {} }
  const rank = (n: string) => {
    const i = prefer.indexOf(n)
    return i < 0 ? prefer.length : i
  }
  cut.sort((a, b) => rank(a.name) - rank(b.name))
  const ref = cut.reduce((a, s) => (s.segs.length > a.segs.length ? s : a), cut[0])
  const index = cut.map(s => new Map(s.segs.map(g => [g.key, g])))
  // Tours de TOUS les journaux, dans l'ordre du combat : aucun ne les a tous (chaque journal se tait pendant le tour de
  // son personnage et celui d'avant, QUIET_AROUND_MY_TURN). Avant le 2026-10-10 au soir, seuls les tours du journal de
  // référence étaient gardés : ceux qu'il n'avait pas manquaient (combat de 21:11 : le tour de Lowkey, ses poussées).
  // Ordre : tri topologique des tours (chaque journal donne l'ordre de ceux qu'il a), à égalité la manche, puis l'ordre
  // de première apparition (journal de référence d'abord).
  const first = new Map<string, { seg: Segment; rank: number; round: number }>()
  for (const s of [ref, ...cut.filter(c => c !== ref)]) {
    for (const g of s.segs) if (!first.has(g.key)) first.set(g.key, { seg: g, rank: first.size, round: Number(g.key.split(':')[0]) })
  }
  const next = new Map<string, Set<string>>()
  const indeg = new Map<string, number>([...first.keys()].map(k => [k, 0]))
  for (const s of cut) {
    for (let i = 1; i < s.segs.length; i++) {
      const a = s.segs[i - 1].key
      const b = s.segs[i].key
      const out = next.get(a) ?? new Set<string>()
      if (!out.has(b)) {
        out.add(b)
        indeg.set(b, (indeg.get(b) ?? 0) + 1)
      }
      next.set(a, out)
    }
  }
  const before = (a: string, b: string) => {
    const x = first.get(a)!
    const y = first.get(b)!
    return x.round - y.round || x.rank - y.rank
  }
  const ready = [...indeg].filter(([, d]) => d === 0).map(([k]) => k)
  const order: Segment[] = []
  while (ready.length) {
    ready.sort(before)
    const k = ready.shift()!
    order.push(first.get(k)!.seg)
    for (const b of next.get(k) ?? []) {
      indeg.set(b, indeg.get(b)! - 1)
      if (indeg.get(b) === 0) ready.push(b)
    }
  }
  // Cycle (journaux contradictoires, en principe impossible) : le reste dans l'ordre manche / apparition.
  if (order.length < first.size) {
    const done = new Set(order.map(g => g.key))
    order.push(...[...first.keys()].filter(k => !done.has(k)).sort(before).map(k => first.get(k)!.seg))
  }
  const rows: Row[] = [...ref.prologue]
  const sources: Record<string, number> = {}
  let round = Math.max(1, ...ref.prologue.filter(r => r.k === 'm' && r.n === MSG.round).map(r => r.d?.fxjj ?? 1))
  order.forEach((g, k) => {
    const player = names.get(g.fighter)
    // Tour suivant dans l'ordre fusionné : le découpage d'un journal qui l'a aussi vu juste après celui-ci est fiable
    // (un journal qui l'a manqué peut avoir accroché à ce tour des messages arrivés après son silence).
    const after = order[k + 1]?.key
    let pick: Segment | undefined
    let from = ''
    let pickOk = false
    for (const own of [false, true]) {
      // Aucun autre journal n'a ce tour : celui du joueur lui-même.
      if (pick) break
      for (let i = 0; i < cut.length; i++) {
        if (!own && cut[i].name === player) continue
        const x = index[i].get(g.key)
        if (!x) continue
        const ok = x.next === after
        // Le plus complet des journaux fiables (un journal en retard, ou qui a perdu des messages, est plus court) ; à
        // égalité, l'ordre de préférence.
        if (!pick || (ok && !pickOk) || (ok === pickOk && x.rows.length > pick.rows.length)) {
          pick = x
          from = cut[i].name
          pickOk = ok
        }
      }
    }
    if (!pick) return
    // Débuts de manche remis à leur place, avant le premier tour de chaque manche : le plus complet des journaux qui ont
    // vu ce tour juste après (un journal qui s'est tu au début de la manche a pu y accrocher des messages arrivés après
    // son silence : 2026-10-13 à 17:19, 900 dégâts de fin du tour de Java comptés deux fois), sinon le plus complet.
    while (round < g.round) {
      round++
      const blocks = cut.map(c => ({ rows: c.rounds.get(round), ok: c.roundNext.get(round) === g.key })).filter((b): b is { rows: Row[]; ok: boolean } => !!b.rows)
      const longest = (l: { rows: Row[] }[]) => l.reduce<Row[] | undefined>((a, b) => (!a || b.rows.length > a.length ? b.rows : a), undefined)
      const best = longest(blocks.filter(b => b.ok)) ?? longest(blocks)
      rows.push(...(best ?? [{ k: 'm', n: MSG.round, d: { fxjj: round }, at: pick.rows[0]?.at ?? '' }]))
    }
    sources[from] = (sources[from] ?? 0) + 1
    rows.push(...pick.rows)
  })
  const end = cut.map(c => c.end).find(r => r)
  if (end) rows.push(end)
  return { rows, sources }
}

/**
 * Combats d'un groupe de journaux (une session), dans l'ordre : de quoi fusionner chacun (`mergeStreams(…, { at })` ou
 * `{ index }` pour des journaux sans heures). Les débuts de manche 1 vus par les journaux sont regroupés quand ils sont
 * à moins de CLUSTER_MS les uns des autres.
 */
export function fightsOf(streams: Stream[]): MergeOptions[] {
  const starts = streams.map(s => round1Starts(s.rows))
  const all = starts.flat()
  if (!all.length) return []
  if (all.some(x => x.ms === undefined)) {
    const most = Math.max(...starts.map(l => l.length))
    return Array.from({ length: most }, (_, index) => ({ index }))
  }
  const times = all.map(x => x.ms!).sort((a, b) => a - b)
  const out: MergeOptions[] = []
  let group: number[] = []
  for (const t of times) {
    if (group.length && t - group[group.length - 1] > CLUSTER_MS) {
      out.push({ at: group[group.length - 1] })
      group = []
    }
    group.push(t)
  }
  out.push({ at: group[group.length - 1] })
  return out
}
