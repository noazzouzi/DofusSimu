// Reconstitution d'un combat réel à partir du journal AnkaBot (tools/ankabot/journal-combats.lua) : chaque paquet du
// serveur est rejoué sur un état (cases, PV, érosion, bouclier, PA/PM, invocations, morts), qui est vérifié contre les
// synchronisations complètes envoyées par le serveur et les photos d'AnkaBot ; le résultat est un replay pour la
// section « Combats » du simulateur web (paquets non interprétés gardés en lignes de journal du replay).
//
// Protocole (noms obfusqués relevés le 2026-10-10 ; à relever à nouveau après une rotation par Ankama) :
//   jvi nouvelle manche (fxjj) · jvj début de tour (fxjr) · jup fin de tour (fxgo) · jnz déplacement (fwab chemin,
//   fwaf combattant) · juo synchronisation complète (fxgj : combattants, case gcax.gblc, équipe gcay.gcar.gcad.gdns,
//   joueur gcah {gbyn nom, gbxy classe, gbyc niveau}, monstre gcai.gbzm {gbyz monstre, gbyx grade, gbyy niveau},
//   caractéristiques gcac.gdeq) · jtk caractéristiques modifiées (fwzp combattant, fwzo.gdeq) · juh effet ajouté
//   (fxet.gdzl : gdqb sort, gdpw durée, gdpz lanceur ; gdzn cible ; gdzm effet) · jvu ordre de jeu · jwh fin de combat
//   (statistiques par personnage) · juq nouvelle vague (fxgt numéro ; ses monstres arrivent par la synchronisation
//   suivante) · jwi combattant montré (fxmz : case d'un invisible qui réapparaît) · jsq action (fwuv = numéro de l'effet
//   du jeu, effects.json ; fwuw auteur ; une variante remplie : fwuy sort lancé, fwwd PV perdus, fwwf soins, fwvj PA/PM,
//   fwvb poussée, fwva échange, fwvp téléportation, fwuz mort, fwvi invocation, fwvf/fwvy glyphe ou piège posé/retiré,
//   fwvq piège déclenché, fwvd effets retirés, fwvm apparence, fwvk invisibilité, fwvl position d'un invisible).
// Caractéristiques (gboz → characteristics.json) : 0 PV de base, 11 vitalité, 97 PV perdus, 102 érosion,
// 96 bouclier, 1 PA, 23 PM. PV = PV de base + vitalité + PV perdus ; PV max = PV de base + vitalité − érosion.
import type { Element } from '../../src/core/types'
import type { FightEvent, FighterSnapshot } from '../../src/engine/types'
import type { Replay } from '../../src/replay/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, data } from '../reine-des-voleurs/planificateur/etat'
import { characters, readStream, type Row } from '../reine-des-voleurs/planificateur/journal'

/** Flux d'un personnage d'un journal : celui demandé, sinon le chef du groupe (Lowkey-Jealous), sinon le plus long. */
export function loadStream(file: string, perso?: string): { rows: Row[]; character: string; owner: number } {
  const chars = characters([file])
  let owner: number | undefined
  let best = -1
  for (const [id, name] of chars) {
    if (perso && name !== perso) continue
    if (!perso && name === 'Lowkey-Jealous') {
      owner = id
      break
    }
    const n = readStream([file], id).length
    if (n > best) {
      best = n
      owner = id
    }
  }
  if (owner === undefined) throw new Error(`Personnage ${perso ?? ''} introuvable dans ${file}`)
  return { rows: readStream([file], owner), character: chars.get(owner) ?? String(owner), owner }
}

export const MSG = {
  round: 'jvi', turnStart: 'jvj', turnEnd: 'jup', move: 'jnz', action: 'jsq', sync: 'juo', carac: 'jtk',
  effect: 'juh', turnList: 'jvu', end: 'jwh', wave: 'juq', reveal: 'jwi', seqStart: 'jqh', seqEnd: 'jsy',
} as const

/** Apparence d'une Bonbombe passée au bleu (action fwvm, fwnw.gbmq). */
export const BLUE_BOMB_LOOK = 2866

const C = { hp: 0, vitality: 11, loss: 97, erosion: 102, shield: 96, ap: 1, mp: 23 } as const

/** Variantes de l'action (champ rempli) → sens. */
const AP_ACTIONS = new Set([101, 102, 168, 84])
const MP_ACTIONS = new Set([127, 128, 129, 169, 77])

export interface Fighter {
  gameId: number
  id: number
  name: string
  team: 0 | 1
  kind: 'player' | 'monster' | 'summon'
  monsterId?: number
  grade?: number
  breedId?: number
  level: number
  cell: number
  alive: boolean
  summonerId?: number
  carac: Map<number, number>
}

export interface Check {
  /** Origine de la vérification : synchronisation du serveur ou photo d'AnkaBot. */
  source: 'sync' | 'photo'
  at: number
  round: number
  fighter: string
  field: 'case' | 'PV' | 'PV max' | 'présence'
  expected: number | string
  got: number | string
}

export interface Rebuild {
  replay: Replay
  fighters: Fighter[]
  rounds: number
  turns: number
  actions: number
  /** Paquets du combat par nom, et ceux que la reconstitution n'interprète pas (gardés en journal du replay). */
  messages: Record<string, number>
  unhandled: Record<string, number>
  checks: { sync: { ok: number; bad: number }; photo: { ok: number; bad: number }; mismatches: Check[] }
  /** Dégâts infligés par personnage : reconstitués et statistiques de fin de combat du serveur. */
  damageBy: Record<string, { rebuilt: number; server?: number }>
  /**
   * Lancers VOLONTAIRES (indices dans replay.events) : premier lancer d'une séquence de type 0 ouverte par le combattant
   * dont c'est le tour, pendant son tour. Les autres sont déclenchés (Péché Mignon, Bleu Turquoise, ripostes, rebonds…).
   */
  voluntary: Set<number>
  /** Caractéristiques de chaque combattant à sa première synchronisation (début du combat ou arrivée de sa vague). */
  initialCarac: Map<number, Map<number, number>>
  /**
   * Changements de caractéristiques (jtk, synchronisations) dans l'ordre : `ev` = indice dans replay.events de
   * l'événement qui suit le changement (le changement le précède).
   */
  caracLog: { ev: number; fighter: number; values: [number, number][] }[]
  /**
   * Effets posés (juh), dans l'ordre : `ev` = indice dans replay.events de leur ligne de journal. `param` = paramètre
   * de l'effet (état pour 950/951, valeur…), `spellId` = sort d'origine, `uid` = effectUid des données (l'effet exact
   * du sort), `delay` / `duration` = champs bruts gdpt.gcra / gdpt.gcqz (« délai 3 » des données y vaut 4), `trigger` =
   * déclencheurs d'un buff (« I » immédiat).
   */
  buffs: { ev: number; target: number; caster?: number; effectId: number; param: number; spellId: number; uid?: number; delay?: number; duration?: number; trigger?: string }[]
  /** Effets d'un sort retirés d'un combattant (action fwvd), dans l'ordre : `ev` comme pour `buffs`. */
  dispels: { ev: number; target: number; spellId: number }[]
  /** Retraits de PA (action 308) ou de PM (309) esquivés (variante fwvr) : `ev` comme pour `buffs`. */
  dodges: { ev: number; source?: number; target: number; kind: 'PA' | 'PM'; amount: number }[]
  /** Carte du combat : `opts.mapId`, sinon la plus fréquente des photos d'AnkaBot du combat, sinon 137101316. */
  mapId: number
  mapSource: 'option' | 'photos' | 'défaut'
}

/** Liste du journal : une liste vide peut être écrite {} (table Lua vide). */
const arr = (x: any): any[] => (Array.isArray(x) ? x : [])

const caracValue = (x: any): number => {
  if (x.gbpc) return x.gbpc.gcuw ?? 0
  const parts = x.gbpd ?? x.gbpb
  if (!parts) return 0
  return Object.values(parts).reduce((s: number, v) => s + (typeof v === 'number' ? v : 0), 0)
}

function setCaracs(f: Fighter, list: any[] | undefined): void {
  for (const x of arr(list)) if (typeof x?.gboz === 'number') f.carac.set(x.gboz, caracValue(x))
}

const g = (f: Fighter, id: number) => f.carac.get(id) ?? 0
export const hpOf = (f: Fighter) => g(f, C.hp) + g(f, C.vitality) + g(f, C.loss)
export const maxHpOf = (f: Fighter) => g(f, C.hp) + g(f, C.vitality) - g(f, C.erosion)

const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`

let effectTexts: Map<number, string> | undefined
/** Description d'un effet du jeu (effects.json), #1 / #2 remplacés par ses paramètres. */
function effectText(id: number, p1: number, p2: number): string {
  if (!effectTexts) {
    effectTexts = new Map()
    try {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, 'dofusdb', 'effects.json'), 'utf8'))
      for (const x of Array.isArray(raw) ? raw : Object.values<any>(raw)) {
        const t = x?.description?.fr ?? x?.description
        if (typeof x?.id === 'number' && typeof t === 'string') effectTexts.set(x.id, t)
      }
    } catch {
      // données absentes : numéro seul
    }
  }
  const t = effectTexts.get(id)
  if (!t) return `effet ${id} (${p1})`
  const text = t.replace(/\{\{[^}]*\}\}/g, '').replace(/#1/g, String(p1)).replace(/#2/g, String(p2)).replace(/#3/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return /^-?\d*$/.test(text) ? `effet ${id} (${p1})` : text
}
const monsterName = (id: number) => data.monster(id)?.name ?? `monstre ${id}`

/** Combat à reconstituer dans un flux : de la dernière manche 1 (ou de la n-ième) jusqu'à la fin de combat ou du flux. */
export function fightRange(rows: Row[], which = -1): { from: number; to: number } {
  const starts = rows.map((r, i) => (r.k === 'm' && r.n === MSG.round && r.d?.fxjj === 1 ? i : -1)).filter(i => i >= 0)
  if (!starts.length) throw new Error('Aucun début de combat (manche 1) dans le journal')
  const k = which < 0 ? starts.length + which : which
  const from = starts[Math.max(0, Math.min(starts.length - 1, k))]
  let to = rows.length
  for (let i = from + 1; i < rows.length; i++) {
    if (rows[i].k !== 'm') continue
    if (rows[i].n === MSG.end || (rows[i].n === MSG.round && rows[i].d?.fxjj === 1)) {
      to = rows[i].n === MSG.end ? i + 1 : i
      break
    }
  }
  return { from, to }
}

/**
 * Carte d'un combat d'après les photos d'AnkaBot (map:currentMapId) : la plus fréquente, car la première photo d'un
 * combat peut encore donner la carte d'entrée de la salle (2026-10-13 : 137101312 puis 137101316 pour la Reine).
 */
export function mapOfFight(fight: Row[]): number | undefined {
  const counts = new Map<number, number>()
  for (const r of fight) if (r.k === 's' && typeof r.map === 'number') counts.set(r.map, (counts.get(r.map) ?? 0) + 1)
  let best: number | undefined
  for (const [id, n] of counts) if (best === undefined || n > counts.get(best)!) best = id
  return best
}

export function rebuild(rows: Row[], opts: { which?: number; title?: string; mapId?: number } = {}): Rebuild {
  const { from, to } = fightRange(rows, opts.which ?? -1)
  const fight = rows.slice(from, to)
  const seen = mapOfFight(fight)
  const mapId = opts.mapId ?? seen ?? 137101316
  const mapSource: Rebuild['mapSource'] = opts.mapId !== undefined ? 'option' : seen !== undefined ? 'photos' : 'défaut'
  const firstSync = fight.find(r => r.k === 'm' && r.n === MSG.sync)
  if (!firstSync) throw new Error('Pas de synchronisation des combattants (juo) dans ce combat')
  const byGame = new Map<number, Fighter>()
  const fighters: Fighter[] = []
  const add = (f: Omit<Fighter, 'id'>): Fighter => {
    const x = { ...f, id: fighters.length } as Fighter
    fighters.push(x)
    byGame.set(x.gameId, x)
    return x
  }
  const fromSync = (e: any): Omit<Fighter, 'id'> => {
    const player = e.gcay?.gcar?.gcah
    const mon = e.gcay?.gcar?.gcai?.gbzm
    const f: Omit<Fighter, 'id'> = {
      gameId: e.gcaw,
      name: player?.gbyn ?? `${monsterName(mon?.gbyz)} ${e.gcaw}`,
      team: (e.gcay?.gcar?.gcad?.gdns ?? (player ? 0 : 1)) as 0 | 1,
      kind: player ? 'player' : 'monster',
      monsterId: mon?.gbyz,
      grade: mon?.gbyx,
      breedId: player?.gbyr?.gbxy,
      level: player?.gbyr?.gbyc ?? mon?.gbyy ?? 1,
      cell: e.gcax?.gblc ?? -1,
      alive: true,
      carac: new Map(),
    }
    setCaracs(f as Fighter, e.gcay?.gcar?.gcac?.gdeq)
    return f
  }
  for (const e of arr(firstSync.d.fxgj)) add(fromSync(e))

  const snap = (f: Fighter): FighterSnapshot => ({
    id: f.id, team: f.team, kind: f.kind, name: f.name, breedId: f.breedId, monsterId: f.monsterId, level: f.level,
    hp: hpOf(f), maxHp: maxHpOf(f), ap: g(f, C.ap), mp: g(f, C.mp), cell: f.cell,
    summonerId: f.summonerId !== undefined ? byGame.get(f.summonerId)?.id : undefined,
  })
  const events: FightEvent[] = [{ t: 'fightStart', mapId, fighters: fighters.map(snap), seed: 0 }]
  const buffs: Rebuild['buffs'] = []
  const dispels: Rebuild['dispels'] = []
  const dodges: Rebuild['dodges'] = []
  const messages: Record<string, number> = {}
  const unhandled: Record<string, number> = {}
  const mismatches: Check[] = []
  const checks = { sync: { ok: 0, bad: 0 }, photo: { ok: 0, bad: 0 }, mismatches }
  const damageBy: Record<string, { rebuilt: number; server?: number }> = {}
  let round = 0, turns = 0, actions = 0, current: Fighter | undefined
  let wave = 1
  const voluntary = new Set<number>()
  /** Combattants que le serveur a cachés (téléportés en −1 en devenant invisibles) : case inconnue jusqu'à la prochaine synchronisation. */
  const hidden = new Set<number>()
  /** Combattants invisibles (fwvk) : ils se déplacent sans que le serveur le dise ; la synchronisation donne leur case. */
  const invisible = new Set<number>()
  const initialCarac = new Map<number, Map<number, number>>(fighters.map(f => [f.id, new Map(f.carac)]))
  const caracLog: Rebuild['caracLog'] = []
  const logCarac = (f: Fighter, list: any[] | undefined) => {
    const values: [number, number][] = []
    for (const x of arr(list)) if (typeof x?.gboz === 'number') values.push([x.gboz, caracValue(x)])
    if (values.length) caracLog.push({ ev: events.length, fighter: f.id, values })
  }
  /** Séquences d'actions ouvertes (jqh … jsy) : type, auteur, lancers vus. */
  const stack: { type: number; author: number; casts: number }[] = []
  const log = (text: string) => events.push({ t: 'log', text })
  const who = (gid: number) => byGame.get(gid)
  const nameOf = (gid: number) => who(gid)?.name ?? String(gid)
  const note = (n: string, why: string) => {
    unhandled[n] = (unhandled[n] ?? 0) + 1
    void why
  }
  const compare = (source: 'sync' | 'photo', at: number, f: Fighter, field: Check['field'], expected: number | string, got: number | string) => {
    const ok = expected === got
    checks[source][ok ? 'ok' : 'bad']++
    if (!ok && mismatches.filter(m => m.source === source).length < 400) mismatches.push({ source, at, round, fighter: f.name, field, expected, got })
  }

  for (let idx = 0; idx < fight.length; idx++) {
    const r = fight[idx]
    if (r.k === 's') {
      // Photo d'AnkaBot : cases et PV des combattants vivants connus.
      for (const e of arr(r.e)) {
        const f = who(e.Id)
        if (!f || !f.alive) continue
        compare('photo', idx, f, 'case', e.CellId, f.cell)
        if (typeof e.LifePoints === 'number') compare('photo', idx, f, 'PV', e.LifePoints, hpOf(f))
        if (typeof e.MaxLifePoints === 'number') compare('photo', idx, f, 'PV max', e.MaxLifePoints, maxHpOf(f))
      }
      continue
    }
    if (r.k !== 'm') continue
    messages[r.n!] = (messages[r.n!] ?? 0) + 1
    const d = r.d ?? {}
    switch (r.n) {
      case MSG.round:
        round = d.fxjj
        events.push({ t: 'roundStart', round })
        break
      case MSG.turnStart: {
        current = who(d.fxjr)
        if (!current) note(`${r.n} (combattant inconnu)`, String(d.fxjr))
        if (current) {
          turns++
          events.push({ t: 'turnStart', fighter: current.id, ap: g(current, C.ap), mp: g(current, C.mp) })
        }
        break
      }
      case MSG.turnEnd: {
        const f = who(d.fxgo)
        if (f) events.push({ t: 'turnEnd', fighter: f.id })
        current = undefined
        break
      }
      case MSG.seqStart:
        stack.push({ type: d.fwji, author: d.fwjj, casts: 0 })
        break
      case MSG.seqEnd:
        stack.pop()
        break
      case MSG.move: {
        const f = who(d.fwaf)
        const path: number[] = arr(d.fwab)
        if (f && path.length) {
          events.push({ t: 'move', fighter: f.id, path, mpUsed: path.length - 1 })
          f.cell = path[path.length - 1]
          hidden.delete(f.id)
        }
        break
      }
      case MSG.carac: {
        const f = who(d.fwzp)
        if (f) {
          setCaracs(f, d.fwzo?.gdeq)
          logCarac(f, d.fwzo?.gdeq)
        }
        break
      }
      case MSG.wave:
        wave = d.fxgt ?? wave + 1
        break
      case MSG.reveal: {
        const f = who(d.fxmz?.gcaw)
        const cell = d.fxmz?.gcax?.gblc
        if (f && typeof cell === 'number' && cell !== f.cell) {
          events.push({ t: 'teleport', target: f.id, from: f.cell, to: cell })
          f.cell = cell
        }
        if (f && typeof cell === 'number' && cell >= 0) hidden.delete(f.id)
        break
      }
      case MSG.sync: {
        // Synchronisation complète du serveur : vérification de l'état reconstitué, puis recalage. Les combattants
        // encore inconnus sont ceux d'une nouvelle vague.
        const arrivals: FighterSnapshot[] = []
        for (const e of arr(d.fxgj)) {
          const f = who(e.gcaw)
          const s = fromSync(e)
          if (!f) {
            const x = add(s)
            initialCarac.set(x.id, new Map(x.carac))
            arrivals.push(snap(x))
            continue
          }
          // Case −1 : invisible dont le serveur n'a pas dit où il est (Brume de la Reine, poussé à l'aveugle) ; la
          // synchronisation la donne (combat du 2026-10-10 à 23:01, manche 5 : 288), ce n'est pas un écart. De même pour
          // un combattant caché par le serveur (téléporté en −1) : la Reine invisible qui se déplace sans être vue
          // (combat du 2026-10-12 à 18:47, manche 8 : 301 → 274).
          // Combattant que la synchronisation cache elle-même (case −1, caractéristiques vides : la Reine invisible,
          // combat du 2026-10-12 à 19:16, manche 6) : rien à vérifier ni à recaler, on garde l'état reconstitué.
          const masque = s.cell < 0 && !Array.isArray(e.gcay?.gcar?.gcac?.gdeq)
          if (masque) {
            hidden.add(f.id)
            continue
          }
          // Invisible : déplacé sans être vu (la Magouille, combat du 2026-10-13 à 17:19, manche 9 : 260 → 246).
          if (f.cell >= 0 && !hidden.has(f.id) && !invisible.has(f.id)) compare('sync', idx, f, 'case', s.cell, f.cell)
          hidden.delete(f.id)
          compare('sync', idx, f, 'PV', hpOf(s as Fighter), hpOf(f))
          compare('sync', idx, f, 'PV max', maxHpOf(s as Fighter), maxHpOf(f))
          f.cell = s.cell
          f.carac = s.carac
          f.alive = true
          logCarac(f, e.gcay?.gcar?.gcac?.gdeq)
        }
        if (arrivals.length) events.push({ t: 'wave', index: wave, total: Math.max(wave, 5), fighters: arrivals })
        break
      }
      case MSG.effect: {
        // Effet posé (fxet.gdzl : gdzm effet du jeu, gdps paramètre — valeur, état… —, gdqb sort ou paramètre 2,
        // gdqh sort d'origine, gdpz lanceur, gdpw numéro). Sa durée n'est pas encore décodée avec certitude : écrit
        // dans le journal du replay plutôt qu'en effet actif (qui ne se retirerait pas).
        const e = d.fxet?.gdzl
        const target = who(d.fxet?.gdzn)
        if (e && target) {
          log(`${target.name} : ${effectText(d.fxet.gdzm, e.gdps, e.gdqb)} (${spellName(e.gdqh ?? 0)}, par ${nameOf(e.gdpz)})`)
          buffs.push({ ev: events.length - 1, target: target.id, caster: who(e.gdpz)?.id, effectId: d.fxet.gdzm, param: e.gdps ?? 0,
            spellId: e.gdqh ?? 0, uid: e.gdpx, delay: e.gdpt?.gcra, duration: e.gdpt?.gcqz, trigger: e.gdqf })
        } else note(r.n!, 'effet')
        break
      }
      case MSG.action: {
        actions++
        const a = d.fwuv as number
        const author = who(d.fwuw)
        if (d.fwuy) {
          const c = d.fwuy
          const spell = c.fwqu?.fwpu ?? 0
          const top = stack.at(-1)
          if (top) top.casts++
          if (author && current && author === current && top?.type === 0 && top.author === author.gameId && top.casts === 1) voluntary.add(events.length)
          if (author) events.push({ t: 'cast', fighter: author.id, spellId: spell, spellName: spellName(spell), cell: c.fwqq,
            crit: c.fwqt === 1, apCost: 0, zone: [c.fwqq] })
        } else if (d.fwwd) {
          const x = d.fwwd
          const t = who(x.fwsf)
          if (t) {
            const amount = x.fwsg ?? 0
            // PV jamais sous 0 : le coup de grâce peut dépasser les PV restants (combat du 2026-10-11 à 00:13, Doublure
            // à 1 PV touchée pour 1 de trop ; la synchronisation suivante la donne à 0).
            t.carac.set(C.loss, g(t, C.loss) - Math.min(amount, Math.max(0, hpOf(t))))
            t.carac.set(C.erosion, g(t, C.erosion) + (x.fwsa ?? 0))
            // L'érosion baisse les PV max ; les PV au-dessus suivent (combat du 2026-10-14 à 18:52 : Lamouit à 3700 PV,
            // 2 × 35 d'érosion sans dégâts, 3630 pour le serveur).
            if (hpOf(t) > maxHpOf(t)) t.carac.set(C.loss, -g(t, C.erosion))
            if (x.fwsb) t.carac.set(C.shield, Math.max(0, g(t, C.shield) - x.fwsb))
            const el = (x.fwse ?? -1) as Element | -1
            events.push({ t: 'damage', source: author?.id ?? t.id, target: t.id, amount, element: el,
              kind: el === -1 ? 'push' : 'direct', erosion: x.fwsa, shieldAbsorbed: x.fwsb || undefined })
            if (author) {
              const key = author.kind === 'player' ? author.name : author.summonerId !== undefined ? nameOf(author.summonerId) : author.name
              ;(damageBy[key] ??= { rebuilt: 0 }).rebuilt += t.team !== author.team ? amount : 0
            }
          }
        } else if (d.fwwf) {
          const t = who(d.fwwf.fwsl)
          const amount = d.fwwf.fwsn ?? 0
          if (t) {
            // Soin plafonné aux PV max ÉRODÉS (combat du 2026-10-14 à 18:52 : Lamouit soignée par son vol de vie jusqu'à
            // 3700 au lieu de 3630, 70 d'érosion).
            t.carac.set(C.loss, Math.min(-g(t, C.erosion), g(t, C.loss) + amount))
            events.push({ t: 'heal', source: author?.id ?? t.id, target: t.id, amount })
          }
        } else if (d.fwvl) {
          const t = who(d.fwvl.fwpp)
          if (t && typeof d.fwvl.fwpn === 'number' && d.fwvl.fwpn >= 0 && d.fwvl.fwpn !== t.cell) {
            events.push({ t: 'teleport', target: t.id, from: t.cell, to: d.fwvl.fwpn })
            t.cell = d.fwvl.fwpn
          }
        } else if (d.fwvj) {
          const t = who(d.fwvj.fwpj)
          const delta = d.fwvj.fwpi ?? 0
          if (t) events.push({ t: 'apmp', target: t.id, ap: AP_ACTIONS.has(a) ? delta : 0, mp: MP_ACTIONS.has(a) ? delta : 0,
            reason: a === 102 || a === 129 ? 'utilisés' : `action ${a}` })
          if (!AP_ACTIONS.has(a) && !MP_ACTIONS.has(a)) note(`jsq ${a}`, 'PA/PM')
        } else if (d.fwvb) {
          const t = who(d.fwvb.fwsr)
          if (t) {
            events.push({ t: 'push', target: t.id, from: d.fwvb.fwss, to: d.fwvb.fwst })
            t.cell = d.fwvb.fwst
          }
        } else if (d.fwva) {
          const other = who(d.fwva.fwog)
          if (author && other) {
            events.push({ t: 'teleport', target: author.id, from: author.cell, to: d.fwva.fwoh })
            events.push({ t: 'teleport', target: other.id, from: other.cell, to: d.fwva.fwoi })
            author.cell = d.fwva.fwoh
            other.cell = d.fwva.fwoi
          }
        } else if (d.fwvp) {
          const t = who(d.fwvp.fwoc)
          if (t && d.fwvp.fwob >= 0) {
            events.push({ t: 'teleport', target: t.id, from: t.cell, to: d.fwvp.fwob })
            t.cell = d.fwvp.fwob
          } else if (t) {
            hidden.add(t.id)
            log(`${t.name} quitte la carte (téléportation en -1)`)
          }
        } else if (d.fwuz) {
          const t = who(d.fwuz.fwrl)
          if (t) {
            t.alive = false
            // Mort sans dégâts annoncés (Crâ hors de la colonne tué d'un coup par une Bonbombe, combat du 2026-10-12 à
            // 19:16, manche 13) : 0 PV, comme la synchronisation suivante.
            if (hpOf(t) > 0) t.carac.set(C.loss, g(t, C.loss) - hpOf(t))
            events.push({ t: 'death', target: t.id, killer: author?.id })
          }
        } else if (d.fwvi) {
          for (const s of arr(d.fwvi.fwnc?.fwmv)) {
            const place = arr(s.fwmp)[0]
            const id = place?.gdnt?.gcaw
            if (typeof id !== 'number') continue
            const mid = s.fwmk?.fwjd?.fwie
            const f = who(id) ?? add({
              gameId: id, name: `${monsterName(mid)} ${id}`, team: (place.gdns ?? author?.team ?? 1) as 0 | 1, kind: 'summon',
              monsterId: mid, grade: s.fwmk?.fwjd?.fwif, level: 1, cell: place.gdnt.gcax?.gblc ?? -1, alive: true,
              summonerId: d.fwuw, carac: new Map(),
            })
            f.alive = true
            f.cell = place.gdnt.gcax?.gblc ?? f.cell
            setCaracs(f, s.fwml?.gdeq)
            if (!initialCarac.has(f.id)) initialCarac.set(f.id, new Map(f.carac))
            events.push({ t: 'summon', summoner: author?.id ?? f.id, fighter: snap(f) })
          }
        } else if (d.fwvm) {
          const t = who(d.fwvm.fwnx)
          log(`${t?.name ?? d.fwvm.fwnx} change d'apparence (look ${d.fwvm.fwnw?.gbmq})`)
          if (t && d.fwvm.fwnw?.gbmq === BLUE_BOMB_LOOK) events.push({ t: 'state', target: t.id, stateId: BLUE_BOMB_LOOK, name: 'Bleue', added: true })
        } else if (d.fwvk) {
          // Invisibilité (fwmb : 0 = devient invisible, 2 = visible de nouveau — relevé sur la Doublure, Doublage).
          const t = who(d.fwvk.fwmc)
          if (t) events.push({ t: 'state', target: t.id, stateId: 0, name: 'Invisible', added: d.fwvk.fwmb === 0 })
          if (t && d.fwvk.fwmb === 0) invisible.add(t.id)
          else if (t) invisible.delete(t.id)
        } else if (d.fwvd) {
          log(`${nameOf(d.fwvd.fwop)} : effets de ${spellName(d.fwvd.fwom)} retirés (action ${a})`)
          const t = who(d.fwvd.fwop)
          if (t) dispels.push({ ev: events.length - 1, target: t.id, spellId: d.fwvd.fwom ?? 0 })
        } else if (d.fwvf) {
          const m = d.fwvf.fwnh ?? {}
          const cells: number[] = arr(m.gche).map((c: any) => c.gcgt)
          events.push({ t: 'glyph', glyph: { uid: m.gchp ?? 0, cells: cells.length ? cells : [m.gcha], color: '#c84', spellId: m.gchj ?? 0 }, added: true })
        } else if (d.fwvy) {
          events.push({ t: 'glyph', glyph: { uid: d.fwvy.fwlk, cells: [], color: '#c84', spellId: 0 }, added: false })
        } else if (d.fwvq) {
          log(`${nameOf(d.fwvq.fwlr)} déclenche la marque ${d.fwvq.fwlp} en ${d.fwvq.fwlo}`)
        } else if (d.fwvr && (a === 308 || a === 309)) {
          // Retrait de PA (308) ou de PM (309) esquivé : fwsx cible, fwsy points esquivés (relevé le 2026-10-14).
          const t = who(d.fwvr.fwsx)
          const kind = a === 308 ? 'PA' : 'PM'
          log(`${t?.name ?? d.fwvr.fwsx} esquive ${d.fwvr.fwsy} ${kind}`)
          if (t) dodges.push({ ev: events.length - 1, source: author?.id, target: t.id, kind, amount: d.fwvr.fwsy ?? 0 })
        } else {
          const variant = Object.keys(d).find(k => k !== 'fwuv' && k !== 'fwuw' && d[k] !== null && typeof d[k] === 'object')
          note(`jsq ${a}${variant ? ':' + variant : ''}`, 'action')
          log(`action ${a} de ${author?.name ?? d.fwuw} : ${JSON.stringify(variant ? d[variant] : d)}`)
        }
        break
      }
      case MSG.end: {
        for (const [gid, st] of Object.entries<any>(d.fxmu ?? {})) {
          const f = who(Number(gid))
          if (f) (damageBy[f.name] ??= { rebuilt: 0 }).server = st?.fxdf?.fxac
        }
        events.push({ t: 'fightEnd', winner: null, rounds: round, reason: 'fin de combat (journal)' })
        break
      }
      default:
        note(r.n!, 'message')
    }
  }
  if (events.at(-1)?.t !== 'fightEnd') events.push({ t: 'fightEnd', winner: null, rounds: round, reason: 'fin du journal' })
  const map = data.map(mapId)
  return {
    replay: { events, map, meta: { title: opts.title ?? 'Combat réel (journal AnkaBot)', description: 'Reconstitué paquet par paquet depuis data/fightlogs' } },
    fighters, rounds: round, turns, actions, messages, unhandled, checks, damageBy, voluntary, initialCarac, caracLog, buffs, dispels, dodges, mapId, mapSource,
  }
}
