// Planificateur de tour « formation en colonne » contre la Reine des Voleurs : la tactique du combat réel du 2026-10-10
// (4 Crâs sur une colonne, une case sur deux ; leurs bombes sur la colonne voisine, jamais alignées avec eux).
//
// Un tour, comme ceux du combat réel :
//  1. depuis sa case : sorts de soutien (Tirs Puissants, Tirs Éloignés, Acuité Absolue…), et au plus une poussée de
//     bombe (Flèche de Recul sur sa bombe alignée, Dispersion pour dégager l'axe de tir) ;
//  2. déplacement vers une case de tir d'où le retour reste possible avec les PM qui restent ;
//  3. sorts offensifs (faisceau joué par le vrai moteur, règles du combat de regles.ts), poussées comprises ;
//  4. retour OBLIGATOIRE sur sa case de la colonne (la marque de « Jeu Dangereux » posée dessus arrête le pas : on y
//     finit de toute façon).
// Reine cachée sous Brume (plusieurs cases possibles, brume.ts) : tour de recherche — sorts de soutien, case d'où une
// Flèche Perforante sur le milieu de la brume couvre ses cases possibles, ce tir, puis plan de la suite redemandé (le
// serveur sait alors où elle est).
// Note du tour (fin du tour, retour fait) :
//  + dégâts aux monstres (poids par monstre) et morts (bonus en part de PV max) ;
//  + dégâts des explosions de bombes de la fin de ce tour aux monstres alignés (pousser un monstre sur la colonne des
//    bombes : 1000 Feu par bombe) ;
//  + monstres éloignés des Crâs (la Reine surtout) ;
//  − menaces de leur prochain tour sur chacun des 4 Crâs (pire cas, menaces.ts) : Mort en Sursis (l'échange casse la
//    colonne) bien plus que les autres sorts ;
//  − Crâs tués par les explosions (fin de ce tour : tour écarté ; plus tard : pénalité), ripostes Avertissement reçues.
//
//   npx tsx tools/reine-des-voleurs/planificateur/formation.ts [--fichier <journal.jsonl>] [--manche 3] [--joueur Lamouit]
//                                                              [--top 3] [--faisceau 24]
// Sans --manche : tous les tours de Crâ du journal (tour proposé / tour joué, sur l'état réel de chaque tour).
import { createSpellProfileIndex } from '../../../src/ai/core/spellProfile'
import { canCast, castSpell } from '../../../src/engine/cast'
import type { Engine } from '../../../src/engine/engine'
import { move } from '../../../src/engine/move'
import type { Fighter, FightState, KnownSpell } from '../../../src/engine/types'
import { distance, neighborsOf } from '../../../src/map/geometry'
import { simulateHorizon, type BombWorld } from './bombes'
import { BOMB, QUEEN, buildFight, data, type Snapshot } from './etat'
import { DEATH_ROW, ILLICIT_SPELL, threatsOnCras } from './menaces'
import { reineController } from './monstres'
import { applyCastRules, applyStateRules, novaDamage, shareTwinDamage, twinHp, twinPairs } from './regles'
import { PERFORANTE, hitCells } from './brume'

export type FStep = { kind: 'move'; path: number[] } | { kind: 'cast'; spell: number; cell: number; target?: number }

/** État du combat au début du tour du Crâ actif (sa bombe de la manche posée), pour le planificateur. */
export interface FormationState {
  engine: Engine
  /** Combat du moteur (non modifié par le planificateur). */
  fight: FightState
  /** Identifiant moteur du Crâ qui joue. */
  active: number
  round: number
  /** Identifiant moteur → identifiant de jeu. */
  gameIdOf: Map<number, number>
  /** Bombes (identifiant moteur) : poseur (identifiant de jeu), manche d'apparition, bleue. */
  bombs: Map<number, { owner: number; born: number; blue: boolean }>
  /** Crâs (identifiants de jeu) dans l'ordre de jeu. */
  players: number[]
  /**
   * Crâs à protéger (identifiants de jeu) ; absent : tous ceux de `players`. Mode « 4 Crâs + mule » : la mule est dans
   * `players` (elle a ses Bonbombes et occupe sa case) mais pas ici — sa mort est voulue, elle ne protège personne.
   */
  cras?: number[]
  /** Case de la colonne de chaque Crâ (identifiant de jeu) ; absente : sa case au début du tour. */
  anchors: Map<number, number>
  /** Ordre de jeu complet (identifiants de jeu, bombes exclues) : qui joue entre ce Crâ et chaque monstre. */
  order?: number[]
  /** Reine sous Brume (brume.ts) : milieu de la brume et cases possibles ; dans `fight`, sur sa case si une seule. */
  hidden?: { gid: number; center: number; cells: number[] }
}

/** Ce qu'un Crâ a réellement joué (journal), pour comparaison. */
export interface PlayedTurn {
  round: number
  name: string
  gameId: number
  steps: FStep[]
  /** Dégâts infligés aux monstres pendant le tour (déclenchés compris). */
  damage: number
  endCell: number
}

export interface FormationOptions {
  /** Largeur du faisceau sur les lancers (tous départs confondus). */
  beam?: number
  maxCasts?: number
  /** Cases de tir gardées par variante de départ. */
  shootCells?: number
  /** Nœuds d'où l'on essaie une seconde case de tir (0 : aucune). */
  secondStops?: number
  /** Poids des dégâts par monstre (identifiant de monstre) ; défaut WEIGHTS. */
  weights?: Record<number, number>
  /** Bonus quand un monstre meurt, en part de ses PV max. */
  killBonus?: number
  top?: number
  /** Pénalité par Crâ visé par Mort en Sursis au prochain tour de la Reine, joué par son contrôleur (monstres.ts). */
  deathRow?: number
  /** Pénalité par Crâ que la Reine pourrait atteindre par Mort en Sursis au pire cas (menaces.ts). */
  deathRowThreat?: number
  /** Pénalité par (monstre, Crâ) menacé au pire cas par un autre sort. */
  threat?: number
  /** Note seulement ce tour imposé (ex. le tour joué, d'après le journal) au lieu de chercher. */
  replay?: FStep[]
  /** Lancers interdits, « sort@case@case du lanceur » (refusés en jeu pendant ce tour). */
  forbid?: ReadonlySet<string>
  /**
   * Part de la recherche (serveur à plusieurs fils de calcul) : seuls les départs (case de tir et sorts de soutien) de
   * rang `index` modulo `count` sont développés, avec un faisceau de PARTITION_SLACK × beam / count ; le serveur
   * garde le meilleur plan des `count` parts.
   */
  partition?: { index: number; count: number }
}

/** Priorités de mise à mort (docs/strategies/reine-des-voleurs §2.3) : Terristocrate (Bombe Illicale), Magouille. */
export const WEIGHTS: Record<number, number> = { 3747: 1.3, 3750: 1.2, 3749: 1.1, 3748: 1.0, 3726: 1.1, 3746: 0.9 }
/**
 * Poids de l'éloignement d'un monstre, par case gagnée sur la colonne. Consigne du joueur (2026-10-11) : pousser en
 * priorité les plus dangereux, Reine, Terristocrate et Magouille, le plus loin possible tout en pouvant encore les
 * attaquer ; si la Reine arrive au contact d'un Crâ, le combat est perdu.
 */
const AWAY: Record<number, number> = { 3726: 200, 3747: 150, 3750: 150 }
const AWAY_DEFAULT = 20
/** Distance à la colonne au-delà de laquelle un monstre n'est plus à portée de tir : l'éloigner davantage ne rapporte rien. */
const AWAY_CAP = 12
/**
 * Distance de sécurité par monstre (une case de plus que sa plus longue attaque sur un Crâ, depuis sa case de début de
 * tour) : l'éloigner jusque-là rapporte, au-delà plus rien. Données du jeu (PM + portée, téléportations) et 159 attaques
 * relevées dans 34 combats (2026-10-10 et 2026-10-11) : Reine 15 (Mort en Sursis en chaîne), Terristocrate 14
 * (Fumérus + 4 PM + Bombe Illicale à 6), Magouille 13 (5 PM + Crâmes à 8), Mâchassin 12 (4 PM + Piège à Le Ours à 8 ;
 * Sans se mouiller jusqu'à 14 en ligne), Bourôliste 11 (5 PM + Vers la lumière à 7, puis Coupable), Doublure aucune.
 */
export const SAFE: Record<number, number> = { 3726: 16, 3747: 15, 3750: 14, 3746: 13, 3749: 13 }
const TERRISTOCRATE = 3747
const BOMBE_ILLICALE = 3745
/** Un Crâ à cette distance (ou moins) d'une Bombe Illicale meurt quand le Terristocrate meurt (illicitDeaths). */
const ILLICIT_RADIUS = 2
/** Pénalité par coéquipier sorti de sa case de la colonne par le tour du Crâ actif. */
const OFF_COLUMN = 3000
/** Pénalité par PV retiré à un Crâ par nos propres sorts (zones). */
const FRIENDLY_FIRE = 3
/**
 * Crâ touché qui garde moins de cette part des PV que le tir lui a retirés : compté mort (jets et coups critiques
 * au-dessus de l'espérance ; 11:54, Œil pour Œil prévu à 356 sur Java, 606 en jeu).
 */
const FRIENDLY_MARGIN = 0.8
/**
 * Pénalité quand un Terristocrate peut poser sa Bombe Illicale sur un Crâ à son prochain tour (mort sauf bombe repoussée) ;
 * une seule bombe par tour : chaque Crâ de plus à sa portée ne compte que ILLICIT_EXTRA.
 */
const ILLICIT_THREAT = 20000
const ILLICIT_EXTRA = 1000
const WARNING_POISON = 4783
const WARNING_HIT = 260
/**
 * Tir de Repli : en ligne seulement en jeu, malgré castInDiagonal dans les données (20 lancers réels sur 20 en ligne ;
 * diagonales refusées « PAS_EN_LIGNE » par AnkaBot une douzaine de fois, Kemist manche 3 du combat de 15:32 : tour perdu).
 */
const TIR_DE_REPLI = 32470
/**
 * Marge du faisceau d'une part de la recherche (partition) : 2 × sa part. 32 tours réels du 2026-10-11 : en 6 parts, 2
 * plans un peu moins bons (38 et 115 points) ; en 8 parts, un de 2 544 (la part de la meilleure case de tir manquait de
 * place) ; 4 × en 8 parts ne perd plus, mais 8 fils se gênent (recherche réelle 0,91 s contre 1,16 s d'un seul tenant ;
 * 6 fils à 2 × : 0,66 s).
 */
const PARTITION_SLACK = 2

export interface FormationPlan {
  steps: FStep[]
  shootCells: number[]
  endCell: number
  anchor: number
  atAnchor: boolean
  score: number
  parts: { damage: number; kills: number; nova: number; away: number; threats: number; deaths: number; column: number; ripostes: number; friendly: number }
  /** Dégâts des sorts, et des explosions de fin de tour, par monstre (identifiant de jeu). */
  damage: Map<number, number>
  nova: Map<number, number>
  killed: number[]
  /** Menaces de leur prochain tour : Crâ (identifiant de jeu), monstre (identifiant de jeu), sort (pire cas). */
  threats: { cra: number; monster: number; spell: number }[]
  /** Crâs (identifiants de jeu) visés par Mort en Sursis au prochain tour de la Reine, joué par son contrôleur. */
  deathRowAi: number[]
  /** Crâs tués par les explosions (fin de ce tour, ou plus tard si personne ne bouge). */
  craDeaths: { id: number; atEnd: boolean }[]
  /** Tour de recherche de la Reine sous Brume : s'arrête après le tir, la suite est à redemander (pas de retour). */
  probe?: { center: number; covered: number[]; cells: number[] }
}

interface Node {
  fight: FightState
  steps: FStep[]
  shoots: number[]
  score: number
  sig: string
}

export function planFormationTurn(st: FormationState, opts: FormationOptions = {}): { plans: FormationPlan[]; evaluated: number; ms: number } {
  const t0 = Date.now()
  const part = opts.partition && opts.partition.count > 1 ? opts.partition : undefined
  const share = (n: number, min: number) => (part ? Math.max(min, Math.ceil((n * PARTITION_SLACK) / part.count)) : n)
  const beamWidth = share(opts.beam ?? 24, 4)
  const maxCasts = opts.maxCasts ?? 5
  const keepCells = opts.shootCells ?? 8
  const killBonus = opts.killBonus ?? 0.5
  const weights = { ...WEIGHTS, ...(opts.weights ?? {}) }
  // Mort en Sursis prévue par le contrôleur de la Reine (ce qu'elle a fait 9 tours sur 9) : pénalité forte ; au pire cas
  // (échanges en chaîne qu'elle n'a jamais faits) : légère, comme les autres menaces.
  const pDeathRowAi = opts.deathRow ?? 8000
  const pDeathRow = opts.deathRowThreat ?? 1000
  const pThreat = opts.threat ?? 300
  const { engine } = st
  const base = engine.cloneFight(st.fight)
  // Espérance : jets moyens, coup critique pondéré par sa probabilité (≈ 95 % pour ces Crâs le 2026-10-10).
  base.options.rollMode = 'average'
  base.options.forcedCrit = undefined
  applyStateRules(engine, base)
  const me0 = base.fighters[st.active]
  me0.spells = me0.spells.map(sp => (sp.spellId === TIR_DE_REPLI && sp.level.castInDiagonal ? { ...sp, level: { ...sp.level, castInDiagonal: false } } : sp))
  const myGid = st.gameIdOf.get(me0.id)!
  const anchor = st.anchors.get(myGid) ?? me0.cell
  const crasSet = new Set(st.cras ?? st.players)
  const profiles = createSpellProfileIndex(engine)
  const isBomb = (f: Fighter) => f.monsterId === BOMB
  // (case -1 : invisible hors de la carte, Brume — position inconnue)
  const monsters = (s: FightState) => s.fighters.filter(f => f.alive && f.team !== me0.team && !isBomb(f) && f.cell >= 0)
  const wOf = (f: Fighter) => weights[f.monsterId ?? 0] ?? 1
  const anchorsAll = st.players.filter(g => crasSet.has(g)).map(g => st.anchors.get(g) ?? base.fighters.find(f => st.gameIdOf.get(f.id) === g)?.cell ?? -1).filter(c => c >= 0)
  const nearCra = (cell: number) => Math.min(99, ...anchorsAll.map(a => distance(a, cell)))

  // Pas d'invocations (Balise Tactique, Balise de Survie) : consigne du joueur (2026-10-11), elles cachent des monstres
  // (lignes de vue) et la Reine s'en sert pour s'approcher (Mort en Sursis sur la Balise de Survie, combat de 10:49).
  const usable = me0.spells.filter(sp => profiles.of(sp.level).summons.length === 0)
  const buffs = usable.filter(sp => !profiles.of(sp.level).damage.some(l => l.sides.enemy) && sp.level.range === 0)
  const attacks = usable.filter(sp => !buffs.includes(sp))
  const movers = usable.filter(sp => profiles.of(sp.level).moves.some(l => !l.onCaster))

  const baseHp = new Map(base.fighters.map(f => [f.id, f.alive ? f.hp : 0]))
  const baseNear = new Map(monsters(base).map(m => [m.id, nearCra(m.cell)]))
  let evaluated = 0

  interface PosTerms {
    threats: { cra: number; monster: number; spell: number }[]
    deathRowAi: number[]
    threatScore: number
    /** Dommages bruts des explosions de la fin de ce tour par monstre (identifiant moteur), jumelles partagées. */
    nova: Map<number, number>
    craDeaths: { id: number; atEnd: boolean }[]
    deathScore: number
  }
  const posCache = new Map<string, PosTerms>()
  /** Poids d'une menace du monstre `g` : ×0,4 par Crâ vivant qui joue entre ce Crâ et ce monstre. */
  const urgencyCache = new Map<number, number>()
  function urgency(g: number | undefined): number {
    if (g === undefined || !st.order?.length) return 1
    let u = urgencyCache.get(g)
    if (u !== undefined) return u
    const order = st.order
    const from = order.indexOf(myGid)
    const to = order.indexOf(g)
    let between = 0
    if (from >= 0 && to >= 0) {
      const alivePlayers = new Set(base.fighters.filter(f => f.alive && f.kind === 'player').map(f => st.gameIdOf.get(f.id)).filter(g => g !== undefined && crasSet.has(g)))
      for (let k = (from + 1) % order.length; k !== to; k = (k + 1) % order.length) if (alivePlayers.has(order[k])) between++
    }
    urgencyCache.set(g, (u = 0.4 ** between))
    return u
  }
  /**
   * Ce qui dépend des seules positions (le Crâ actif supposé rentré sur sa case de la colonne) : explosions de la fin
   * du tour (Crâs tués, dommages aux monstres alignés) et menaces du prochain tour des monstres. Mis en cache.
   */
  function posTerms(s: FightState): PosTerms {
    const key = s.fighters.filter(f => f.alive && f.id !== me0.id).map(f => `${f.id}:${f.cell}`).join(',')
    const hit = posCache.get(key)
    if (hit) return hit
    const c = engine.cloneFightForSim(s)
    const m = c.fighters[me0.id]
    if (m.cell !== anchor && engine.isCellFree(c, anchor)) m.cell = anchor
    const h = simulateHorizon({ ...bombWorldOf(st, c), order: st.players }, myGid, st.round)
    const craDeaths = h.deaths.filter(d => crasSet.has(d.id)).map(d => ({ id: d.id, atEnd: d.atActiveEnd }))
    const deathScore = craDeaths.some(d => d.atEnd || d.id === myGid) ? -1e6 : -10000 * craDeaths.length
    const raw = new Map<number, number>()
    for (const e of h.events) {
      if (e.kind !== 'explode' || e.turnOf !== myGid || e.round !== st.round) continue
      for (const [id, dmg] of novaDamage(c, e.cell)) raw.set(id, (raw.get(id) ?? 0) + dmg)
    }
    for (const [a2, b2] of twinPairs(c)) {
      const t = (raw.get(a2) ?? 0) + (raw.get(b2) ?? 0)
      if (t > 0) {
        raw.set(a2, Math.round(t / 2))
        raw.set(b2, Math.round(t / 2))
      }
    }
    // Monstres tués par les explosions : retirés avant les menaces.
    const after = c   // (c est déjà une copie propre à ce calcul)
    for (const [id, dmg] of raw) {
      const f = after.fighters[id]
      if (f.alive && dmg >= f.hp) f.alive = false
    }
    // Bonbombes qui explosent d'ici la fin de la manche (horizon) : retirées aussi, elles ne bouchent plus ni chemin ni
    // ligne de vue au tour de la Reine. Combat de 13:19, manche 2 : la bombe de Java en 356, explosée à la fin du tour
    // de Kemist, cachait la Mort en Sursis de la Reine sur Java (avancée de 6 cases, puis échanges avec Java et Lamouit).
    const gone = new Set(h.events.filter(e => e.kind === 'explode' && e.round === st.round).map(e => e.who))
    for (const f of after.fighters) if (f.alive && isBomb(f) && gone.has(st.gameIdOf.get(f.id) ?? NaN)) f.alive = false
    const threats: PosTerms['threats'] = []
    // (ce que chaque monstre atteint est cherché une fois pour les 4 Crâs : 65 % du calcul d'un plan auparavant)
    const cras = after.fighters.filter(c => c.alive && c.kind === 'player' && crasSet.has(st.gameIdOf.get(c.id) ?? NaN))
    const byCra = threatsOnCras(engine, after, cras)
    for (const cra of cras) for (const t of byCra.get(cra.id) ?? []) threats.push({ cra: st.gameIdOf.get(cra.id)!, monster: st.gameIdOf.get(t.monster) ?? t.monster, spell: t.spell })
    const deathRowAi = queenTargets(after)
    // Une menace pèse surtout sur le dernier Crâ qui joue avant le monstre : les suivants peuvent encore l'écarter.
    const queenGid = [...st.gameIdOf].find(([id]) => after.fighters[id]?.monsterId === QUEEN && after.fighters[id].alive)?.[1]
    const deathRowOn = new Map<number, number>()
    for (const t of threats) if (t.spell === DEATH_ROW) deathRowOn.set(t.cra, t.monster)
    const otherPairs = new Map<string, number>()
    const illicitOn = new Map<number, number>()
    for (const t of threats) {
      if (t.spell === ILLICIT_SPELL) illicitOn.set(t.monster, (illicitOn.get(t.monster) ?? 0) + 1)
      else if (t.spell !== DEATH_ROW) otherPairs.set(`${t.cra}:${t.monster}`, t.monster)
    }
    let threatScore = -pDeathRowAi * deathRowAi.length * urgency(queenGid)
    for (const m of deathRowOn.values()) threatScore -= pDeathRow * urgency(m)
    for (const m of otherPairs.values()) threatScore -= pThreat * urgency(m)
    // Bombe Illicale : le Crâ visé meurt si personne ne repousse la bombe avant le tour suivant du Terristocrate (11:54,
    // Terristocrate apparu à 14 cases de Java, pas repoussé par Lowkey, bombe posée sur Java).
    for (const [m, n] of illicitOn) threatScore -= (ILLICIT_THREAT + ILLICIT_EXTRA * (n - 1)) * urgency(m)
    threatScore = Math.round(threatScore)
    const out = { threats, deathRowAi, threatScore, nova: raw, craDeaths, deathScore }
    posCache.set(key, out)
    return out
  }

  /** Note (recherche et fin de tour) : dégâts, morts, éloignement, explosions, menaces, morts de Crâs. */
  function partial(s: FightState) {
    let damage = 0
    let kills = 0
    let away = 0
    let nova = 0
    const t = posTerms(s)
    for (const f of s.fighters) {
      if (f.team === me0.team || isBomb(f)) continue
      const before = baseHp.get(f.id) ?? 0
      if (before <= 0) continue
      const lost = before - (f.alive ? f.hp : 0)
      if (lost > 0) damage += wOf(f) * lost
      if (!f.alive) kills += killBonus * f.maxHp * wOf(f)
      else {
        const n = t.nova.get(f.id) ?? 0
        if (n > 0) nova += wOf(f) * Math.min(n, f.hp) + (n >= f.hp ? killBonus * f.maxHp * wOf(f) : 0)
        if (f.cell >= 0) {
          const d0 = baseNear.get(f.id)
          const cap = SAFE[f.monsterId ?? 0] ?? AWAY_CAP
          if (d0 !== undefined) away += (AWAY[f.monsterId ?? 0] ?? AWAY_DEFAULT) * (Math.min(cap, nearCra(f.cell)) - Math.min(cap, d0))
        }
      }
    }
    // Tirs sur nos Crâs (zones autour d'un monstre au corps à corps) : PV perdus pénalisés, Crâ tué ou presque comme
    // une mort. Combat de 11:54 : Œil pour Œil de Lowkey et Œil de Taupe de Kemist sur le Bourôliste collé à Java et
    // Lamouit, puis Œil pour Œil de Kemist qui tue Java (la Bombe Illicale près de lui ne comptait plus).
    let friendly = 0
    for (const c of s.fighters) {
      if (c.team !== me0.team || c.kind !== 'player') continue
      const before = baseHp.get(c.id) ?? 0
      if (before <= 0) continue
      const lost = before - (c.alive ? c.hp : 0)
      if (lost <= 0) continue
      friendly -= FRIENDLY_FIRE * lost
      if (!c.alive || c.hp <= FRIENDLY_MARGIN * lost) friendly -= 1e6
    }
    // Retour sur la case de la colonne encore possible (une poussée peut boucher le chemin) : sinon nœud écarté.
    const me = s.fighters[me0.id]
    const back = backTo(s)
    const stuck = me.cell !== anchor && (!back.anchorFree || !((back.dist.get(me.cell) ?? Infinity) <= me.mp))
    const illicit = illicitDeaths(s, t.nova)
    // Colonne obligatoire (consigne du joueur) : un coéquipier sorti de sa case par ce tour (poussée, échange) y reste
    // exposé jusqu'à son propre tour. Permis s'il le faut (le tirer d'une Bombe Illicale), pénalisé sinon.
    let column = 0
    for (const c of s.fighters) {
      if (!c.alive || c.kind !== 'player' || c.id === me0.id) continue
      const g = st.gameIdOf.get(c.id)
      const a = g !== undefined ? st.anchors.get(g) : undefined
      if (a !== undefined && c.cell !== a && base.fighters[c.id].cell === a) column -= OFF_COLUMN
    }
    const score = damage + kills + away + nova + t.threatScore + t.deathScore + illicit + column + friendly + (stuck ? -50000 : 0)
    return { score, damage, kills, away, nova, illicit, column, friendly, terms: t }
  }

  /**
   * Bombe Illicale (invoquée par le Terristocrate, collée au Crâ qu'il vise) : son « Décrochage de cordon » tue le Crâ
   * resté près de la bombe, au début du tour suivant du Terristocrate, ou dès sa mort. Combats du 2026-10-11 : 10:49, le
   * Terristocrate tué avec la bombe à 1 case de Java, Java mort ; 11:23, bombe laissée à 1 case de Java, Java mort au
   * début du tour du Terristocrate ; 00:13 (joué à la main), bombe repoussée à 3 cases de Java puis Terristocrate tué,
   * Java en vie. Seuil prudent : 2 cases. Il faut donc repousser la bombe avant le prochain tour du Terristocrate.
   */
  function illicitDeaths(s: FightState, nova: Map<number, number>): number {
    let out = 0
    for (const b0 of base.fighters) {
      if (!b0.alive || b0.monsterId !== BOMBE_ILLICALE || b0.cell < 0) continue
      // Case de la bombe après le plan, ou à sa mort (le moteur la retire avec son invocateur ; registre des morts).
      const now = s.fighters[b0.id]
      const b = now.alive ? now.cell : ([...(s.deaths ?? [])].reverse().find(d => d.fighter === b0.id)?.cell ?? b0.cell)
      if (b < 0) continue
      const terri = b0.summonerId !== undefined ? s.fighters[b0.summonerId] : undefined
      // Terristocrate tué pendant ce tour : tout de suite (le Crâ actif est alors sur sa case de tir ou déjà rentré) ;
      // tué par les explosions de la fin du tour : tout de suite aussi, Crâ actif rentré (18:11, manche 13 : Java rentré
      // à 1 case de la bombe, rapprochée par ses tirs sur le Mâchassin, Terristocrate achevé par les Bonbombes, Java mort) ;
      // sinon à son prochain tour, si aucun Crâ qui joue avant lui ne repousse la bombe.
      const killedNow = !!terri && !terri.alive && (baseHp.get(terri.id) ?? 0) > 0
      const novaKill = !!terri && terri.alive && (nova.get(terri.id) ?? 0) >= terri.hp
      const now0 = killedNow || novaKill
      const weight = now0 ? 1 : urgency(terri ? st.gameIdOf.get(terri.id) : undefined)
      for (const c of s.fighters) {
        if (!c.alive || c.kind !== 'player') continue
        const cells = c.id === me0.id ? (killedNow ? [c.cell, anchor] : [anchor]) : [c.cell]
        if (cells.some(x => x >= 0 && distance(b, x) <= ILLICIT_RADIUS)) out -= Math.round(1e6 * weight)
      }
    }
    return out
  }

  const sigOf = (s: FightState, steps: FStep[]) => {
    const m = s.fighters[me0.id]
    const casts = steps.filter(x => x.kind === 'cast').map(x => `${(x as { spell: number }).spell}@${(x as { cell: number }).cell}`).sort().join(',')
    const pos = s.fighters.filter(f => f.alive && f.id !== me0.id && (isBomb(f) || f.team !== me0.team)).map(f => f.cell).join(',')
    return `${m.cell}|${m.ap}|${m.mp}|${casts}|${pos}`
  }

  function node(s: FightState, steps: FStep[], shoots: number[]): Node {
    return { fight: s, steps, shoots, score: partial(s).score, sig: sigOf(s, steps) }
  }

  function cast(n: Node, sp: KnownSpell, cell: number): Node | null {
    const m = n.fight.fighters[me0.id]
    // Refus du jeu : sur cette case depuis cette case, ou (« * ») depuis n'importe où (sort « autorisé mais non exécuté »).
    if (opts.forbid?.has(`${sp.spellId}@${cell}@${m.cell}`) || opts.forbid?.has(`${sp.spellId}@${cell}@*`)) return null
    if (canCast(engine, n.fight, m, sp, cell) !== null) return null
    const s = engine.cloneFightForSim(n.fight)
    const twins = twinHp(s)
    const target = s.fighters.find(f => f.alive && f.cell === cell && f.id !== me0.id)
    evaluated++
    if (!castSpell(engine, s, s.fighters[me0.id], sp.spellId, cell).ok || !s.fighters[me0.id].alive) return null
    applyCastRules(engine, s, s.fighters[me0.id], sp.spellId)
    shareTwinDamage(engine, s, twins)
    applyStateRules(engine, s)
    // Reine cachée (Brume) : on vise la CASE, sans la suivre. Le script suit sinon la case qu'AnkaBot lui garde, celle où
    // elle a disparu (combat du 2026-10-11 à 13:13, manche 5 : Flèches Perforantes prévues au milieu, 204, parties en 163).
    const hiddenQueen = !!target && !!st.hidden && st.gameIdOf.get(target.id) === st.hidden.gid
    const tg = target && !hiddenQueen ? st.gameIdOf.get(target.id) : undefined
    return node(s, [...n.steps, { kind: 'cast', spell: sp.spellId, cell, target: tg }], n.shoots)
  }

  function walk(n: Node, to: number): Node | null {
    const s = engine.cloneFightForSim(n.fight)
    const m = s.fighters[me0.id]
    if (m.cell === to) return n
    const path = walkPath(s, m.cell, to, m.mp)
    if (!path) return null
    move(s, m, path, engine)
    if (m.cell !== to) return null
    return node(s, [...n.steps, { kind: 'move', path }], [...n.shoots, to])
  }

  /**
   * Plus court chemin de `from` à `to` en au plus `mp` pas, par des cases libres et sans marque (une marque arrête le
   * pas : « Jeu Dangereux » sous chaque case de début de tour), sauf sur la case d'arrivée.
   */
  function walkPath(s: FightState, from: number, to: number, mp: number): number[] | null {
    const d = walkDistances(s, from, to)
    if (!d.has(to) || d.get(to)!.d > mp) return null
    const path = [to]
    while (path[0] !== from) path.unshift(d.get(path[0])!.prev)
    return path
  }

  /** Distances de marche depuis `from` (cases libres, praticables, sans marque sauf `to`). */
  function walkDistances(s: FightState, from: number, to = -1): Map<number, { d: number; prev: number }> {
    const blocked = new Set(s.fighters.filter(f => f.alive && f.id !== me0.id && f.carriedBy === undefined).map(f => f.cell))
    const trapped = new Set(s.traps.flatMap(t => t.cells))
    const d = new Map([[from, { d: 0, prev: from }]])
    const q = [from]
    for (let k = 0; k < q.length; k++) {
      const c = q[k]
      // Une marque arrête le pas : on n'en repart pas (sauf la case de départ).
      if (c !== from && trapped.has(c)) continue
      for (const x of neighborsOf(c)) {
        if (d.has(x) || blocked.has(x) || !s.map.cells[x]?.walkable) continue
        if (trapped.has(x) && x !== to && to >= 0) continue
        d.set(x, { d: d.get(c)!.d + 1, prev: c })
        q.push(x)
      }
    }
    return d
  }

  /** Cases cibles d'un sort : monstres (et leurs voisines pour les zones), bombes pour les sorts qui déplacent. */
  function targetsFor(s: FightState, sp: KnownSpell, from: number): number[] {
    const p = profiles.of(sp.level)
    const cells = new Set<number>()
    for (const e of monsters(s)) {
      cells.add(e.cell)
      if (p.zoneRadius > 0 || p.needFreeCell) for (const c of neighborsOf(e.cell)) cells.add(c)
    }
    if (p.moves.length) for (const f of s.fighters) if (f.alive && isBomb(f)) {
      cells.add(f.cell)
      for (const c of neighborsOf(f.cell)) cells.add(c)
    }
    // Borne large (portée de base + PO + bonus de sorts comme Tirs Éloignés) : canCast tranche ensuite.
    const max = sp.level.range + (sp.level.rangeBoostable ? Math.max(0, s.fighters[me0.id].stats.range) : 0) + 12
    return [...cells].filter(c => c >= 0 && distance(from, c) <= max)
  }

  // Distance de marche jusqu'à la case de la colonne (chemin symétrique, marques évitées) : budget du retour.
  function returnCost(s: FightState): Map<number, number> {
    return backTo(s).dist
  }

  /**
   * Distances de marche jusqu'à la case de la colonne depuis toutes les cases (parcours depuis la colonne, comme
   * walkDistances(s, anchor) : chemins symétriques, une case marquée atteinte mais pas traversée), et colonne libre.
   * Une par disposition des autres combattants et des marques — la plupart des essais ne déplacent personne : 21 % du
   * calcul d'un plan auparavant (37 tours réels du 2026-10-11), un parcours de toute la carte à chaque essai.
   */
  const backCache = new Map<string, { dist: Map<number, number>; anchorFree: boolean }>()
  function backTo(s: FightState): { dist: Map<number, number>; anchorFree: boolean } {
    let key = ''
    for (const f of s.fighters) if (f.alive && f.id !== me0.id && f.carriedBy === undefined) key += f.cell + ','
    key += '|'
    for (const x of s.traps) key += x.cells.join('.') + ','
    let hit = backCache.get(key)
    if (hit) return hit
    const d = walkDistances(s, anchor)
    const dist = new Map<number, number>()
    for (const [c, x] of d) dist.set(c, x.d)
    const occupied = s.fighters.some(f => f.alive && f.id !== me0.id && f.carriedBy === undefined && f.cell === anchor)
    hit = { dist, anchorFree: !occupied && !!s.map.cells[anchor]?.walkable }
    backCache.set(key, hit)
    return hit
  }

  /** Fin du tour : retour sur la case de la colonne (si `goBack`), puis note complète. Tour de recherche : sans retour. */
  function finish(n: Node, goBack: boolean, probe?: FormationPlan['probe']): FormationPlan {
    const back = !goBack || n.fight.fighters[me0.id].cell === anchor ? n : walk(n, anchor)
    const fin = back ?? n
    const s = fin.fight
    const m = s.fighters[me0.id]
    const p = partial(s)
    const poisons = Math.min(3, m.buffs.filter(b => b.spellId === WARNING_POISON && !(b.triggerCount ?? 0)).length)
    // Poisons de riposte (Avertissement) au début de son prochain tour : mortels si ses PV n'y suffisent pas (21:48,
    // Lamouit à 769 PV, trois poisons de 249 à 260 au début de la manche 15 : morte).
    const lethal = poisons > 0 && m.hp <= poisons * WARNING_HIT * 1.1 ? -1e6 : 0
    const ripostes = -2 * WARNING_HIT * poisons + lethal
    const atAnchor = m.cell === anchor
    const score = p.score + ripostes + (atAnchor || probe ? 0 : -50000)
    const damage = new Map<number, number>()
    const nova = new Map<number, number>()
    const killed: number[] = []
    for (const f of s.fighters) {
      if (f.team === me0.team || isBomb(f)) continue
      const before = baseHp.get(f.id) ?? 0
      const lost = before - (f.alive ? f.hp : 0)
      const g = st.gameIdOf.get(f.id) ?? f.id
      if (lost > 0) damage.set(g, lost)
      if (before > 0 && !f.alive) killed.push(g)
      const nv = f.alive ? Math.min(f.hp, p.terms.nova.get(f.id) ?? 0) : 0
      if (nv > 0) nova.set(g, nv)
    }
    return {
      steps: fin.steps, shootCells: fin.shoots, endCell: m.cell, anchor, atAnchor, score,
      parts: { damage: Math.round(p.damage), kills: Math.round(p.kills), nova: Math.round(p.nova), away: Math.round(p.away), threats: p.terms.threatScore, deaths: p.terms.deathScore + p.illicit, column: p.column, ripostes, friendly: Math.round(p.friendly) },
      damage, nova, killed, threats: p.terms.threats, deathRowAi: p.terms.deathRowAi, craDeaths: p.terms.craDeaths, probe,
    }
  }

  /** Prochain tour de la Reine (contrôleur de monstres.ts, sur un clone) : Crâs visés par Mort en Sursis. */
  function queenTargets(s: FightState): number[] {
    const out: number[] = []
    for (const q0 of s.fighters) {
      if (!q0.alive || q0.monsterId !== QUEEN || q0.cell < 0) continue
      const c = engine.cloneFightForSim(s, true)
      const q = c.fighters[q0.id]
      // Début de son tour : PA / PM pleins, relances décomptées.
      q.ap = q.stats.ap
      q.mp = q.stats.mp
      q.castsThisTurn = {}
      q.castsOnTarget = {}
      q.cooldowns = Object.fromEntries(Object.entries(q.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)]))
      const players = new Map(c.fighters.filter(f => f.alive && f.kind === 'player').map(f => [f.cell, f.id]))
      const from = c.events.length
      try {
        reineController.playTurn(engine, c, q)
      } catch {
        continue
      }
      for (const e of c.events.slice(from)) {
        if (e.t !== 'cast' || e.fighter !== q.id || e.spellId !== DEATH_ROW) continue
        const p = players.get(e.cell)
        if (p !== undefined) out.push(st.gameIdOf.get(p) ?? p)
      }
    }
    return out
  }

  // Tour imposé (ex. celui du journal) : joué pas à pas, noté comme les plans (sans retour ajouté).
  if (opts.replay) {
    let n: Node | null = node(base, [], [])
    for (const x of opts.replay) {
      if (!n) break
      if (x.kind === 'move') {
        // Chemin réel (arrêts sur les marques et tacles compris).
        const s = engine.cloneFightForSim(n.fight)
        const m = s.fighters[me0.id]
        const path = x.path[0] === m.cell ? x.path : [m.cell, ...x.path.slice(1)]
        move(s, m, path, engine)
        n = node(s, [...n.steps, { kind: 'move', path }], [...n.shoots, m.cell])
      }
      else {
        const sp = me0.spells.find(k => k.spellId === x.spell)
        n = sp ? (cast(n, sp, x.cell) ?? n) : n
      }
    }
    return { plans: n ? [finish(n, false)] : [], evaluated, ms: Date.now() - t0 }
  }

  // ── 1. Départ : sorts de soutien (tous les sous-ensembles), puis au plus une poussée de bombe ──
  let roots: Node[] = [node(base, [], [])]
  for (const bf of buffs) {
    const more: Node[] = []
    for (const r of roots) {
      const x = cast(r, bf, r.fight.fighters[me0.id].cell)
      if (x) more.push(x)
    }
    roots = roots.concat(more)
  }
  const fullest = roots.reduce((a, r) => (r.steps.length > a.steps.length ? r : a), roots[0])
  for (const r of [roots[0], fullest]) {
    for (const sp of movers) {
      // Cases d'où le sort déplace la bombe : la sienne, et celles dont la zone l'atteint (Dispersion sur une case vide).
      const reachZone = profiles.of(sp.level).zoneRadius + 1
      const cells = new Set<number>()
      for (const f of r.fight.fighters) {
        if (!f.alive || !isBomb(f)) continue
        for (let c = 0; c < r.fight.map.cells.length; c++) if (distance(c, f.cell) <= reachZone) cells.add(c)
      }
      {
        for (const c of cells) {
          const x = cast(r, sp, c)
          if (!x) continue
          // Seulement si une bombe a bougé (sinon c'est un lancer offensif, essayé plus loin).
          const moved = x.fight.fighters.some(g => isBomb(g) && g.alive && r.fight.fighters[g.id]?.cell !== g.cell)
          if (moved) roots.push(x)
        }
      }
    }
  }

  // ── 1 bis. Reine cachée sous Brume : Flèche Perforante sur le milieu, depuis la case qui couvre le plus de ses cases
  // possibles (puis la meilleure note), d'où le retour reste possible ; la suite du tour est redemandée après le tir ──
  const hid = st.hidden && st.hidden.cells.length > 1 ? st.hidden : undefined
  // (recherche partagée : la part 0 seule fait le tour de recherche de la Reine cachée)
  if (hid && part && part.index !== 0) return { plans: [], evaluated, ms: Date.now() - t0 }
  const fp = hid ? me0.spells.find(sp => sp.spellId === PERFORANTE) : undefined
  if (hid && fp) {
    const prof = profiles.of(fp.level)
    let best: { node: Node; covered: number[]; d: number } | null = null
    for (const r of roots) {
      const s = r.fight
      const m = s.fighters[me0.id]
      const back = returnCost(s)
      for (const [cell, { d }] of walkDistances(s, m.cell)) {
        if (d > m.mp || (d + (back.get(cell) ?? 99) > m.mp && cell !== anchor)) continue
        const zone = hitCells(prof, cell, hid.center)
        const covered = hid.cells.filter(c => zone.has(c))
        if (!covered.length || (best && covered.length < best.covered.length)) continue
        const probe = { ...r, fight: engine.cloneFightForSim(s) }
        probe.fight.fighters[me0.id].cell = cell
        if (canCast(engine, probe.fight, probe.fight.fighters[me0.id], fp, hid.center) !== null) continue
        const w = cell === m.cell ? r : walk(r, cell)
        const x = w && cast(w, fp, hid.center)
        if (!x) continue
        if (!best || covered.length > best.covered.length || x.score - d * 0.01 > best.node.score - best.d * 0.01) best = { node: x, covered, d }
      }
    }
    if (best) {
      const plan = finish(best.node, false, { center: hid.center, covered: best.covered, cells: hid.cells })
      return { plans: [plan], evaluated, ms: Date.now() - t0 }
    }
  }

  // ── 2. Cases de tir : d'où le retour est possible ; classées par le meilleur lancer qu'elles permettent ──
  /** Gain de note du meilleur lancer offensif depuis `cell` (le Crâ y est posé, sans marcher). */
  function bestFrom(r: Node, cell: number): number {
    const s = engine.cloneFightForSim(r.fight)
    const m = s.fighters[me0.id]
    m.cell = cell
    const probe: Node = { ...r, fight: s }
    let best = 0
    for (const sp of attacks) {
      for (const c of targetsFor(s, sp, cell)) {
        if (!monsters(s).some(e => distance(e.cell, c) <= profiles.of(sp.level).zoneRadius)) continue
        const x = cast(probe, sp, c)
        if (x) best = Math.max(best, x.score - r.score)
      }
    }
    return best
  }
  const ranked = new Map<number, number>()
  let frontier: Node[] = []
  for (const r of roots) {
    const s = r.fight
    const m = s.fighters[me0.id]
    const back = returnCost(s)
    const reach = walkDistances(s, m.cell)
    const scored: { cell: number; v: number }[] = []
    for (const [cell, { d: cost }] of reach) {
      if (cost > m.mp) continue
      if (cost + (back.get(cell) ?? 99) > m.mp && cell !== anchor) continue
      // Classement des cases calculé une fois (sur le premier départ), puis réutilisé : les départs ne diffèrent que
      // par les sorts de soutien et une bombe poussée.
      let v = ranked.get(cell)
      if (v === undefined) ranked.set(cell, (v = bestFrom(roots[0], cell)))
      scored.push({ cell, v: v - cost * 0.01 })
    }
    scored.sort((a, b) => b.v - a.v)
    const keep = scored.slice(0, keepCells).map(x => x.cell)
    if (!keep.includes(m.cell)) keep.push(m.cell)
    for (const c of keep) {
      const x = c === m.cell ? { ...r, shoots: [...r.shoots, c] } : walk(r, c)
      if (x) frontier.push(x)
    }
  }

  /**
   * Faisceau diversifié : la meilleure ligne de chaque (case de tir, suite de sorts offensifs) — sinon les variantes de
   * départ, aux notes voisines, évincent une bonne suite —, au plus 3 × `width`, puis les meilleures restantes jusqu'à
   * `width` si la diversité en laisse moins.
   */
  function diverse(nodes: Node[], width: number): Node[] {
    nodes.sort((a, b) => b.score - a.score)
    const out: Node[] = []
    const keys = new Set<string>()
    for (const n of nodes) {
      if (out.length >= 3 * width) break
      const spells = n.steps.filter(x => x.kind === 'cast' && attacks.some(a => a.spellId === x.spell)).map(x => (x as { spell: number }).spell).sort().join(',')
      const k = `${n.fight.fighters[me0.id].cell}|${spells}`
      if (keys.has(k)) continue
      keys.add(k)
      out.push(n)
    }
    const picked = new Set(out)
    for (const n of nodes) {
      if (out.length >= width) break
      if (!picked.has(n)) out.push(n)
    }
    return out
  }

  if (part) {
    // Par case de tir : les départs d'une même case (sorts de soutien différents) dans la même part.
    const cells = [...new Set(frontier.map(x => x.fight.fighters[me0.id].cell))]
    frontier = frontier.filter(x => cells.indexOf(x.fight.fighters[me0.id].cell) % part.count === part.index)
  }

  // ── 3. Faisceau de lancers offensifs, tous départs confondus ──
  const pool: Node[] = [...frontier]
  const seen = new Set(frontier.map(x => x.sig))
  // Premier lancer : tous les départs (leurs notes, encore sans dégâts, ne départagent rien) ; ensuite le faisceau.
  let beam = frontier
  for (let depth = 0; depth < maxCasts; depth++) {
    const next: Node[] = []
    for (const n of beam) {
      const from = n.fight.fighters[me0.id].cell
      for (const sp of attacks) {
        for (const cell of targetsFor(n.fight, sp, from)) {
          const x = cast(n, sp, cell)
          if (!x || seen.has(x.sig)) continue
          seen.add(x.sig)
          next.push(x)
        }
      }
    }
    if (!next.length) break
    beam = diverse(next, beamWidth)
    pool.push(...beam)
  }

  // ── 3 bis. Seconde case de tir (comme au combat réel) : depuis les meilleurs nœuds, encore des PA et des PM ──
  pool.sort((a, b) => b.score - a.score)
  const second: Node[] = []
  for (const n of pool.slice(0, share(opts.secondStops ?? 10, 2))) {
    const s = n.fight
    const m = s.fighters[me0.id]
    if (m.ap < 2 || m.mp < 1) continue
    const back = returnCost(s)
    const reach = walkDistances(s, m.cell)
    const cells: { cell: number; v: number }[] = []
    for (const [cell, { d }] of reach) {
      if (cell === m.cell || d > m.mp || d + (back.get(cell) ?? 99) > m.mp) continue
      cells.push({ cell, v: bestFrom(n, cell) - d * 0.01 })
    }
    cells.sort((x, y) => y.v - x.v)
    for (const { cell, v } of cells.slice(0, 3)) {
      if (v <= 0) continue
      const x = walk(n, cell)
      if (x) second.push(x)
    }
  }
  let beam2 = second
  for (let depth = 0; depth < 3 && beam2.length; depth++) {
    const next: Node[] = []
    for (const n of beam2) {
      const from = n.fight.fighters[me0.id].cell
      for (const sp of attacks) {
        for (const cell of targetsFor(n.fight, sp, from)) {
          const x = cast(n, sp, cell)
          if (!x || seen.has(x.sig)) continue
          seen.add(x.sig)
          next.push(x)
        }
      }
    }
    next.sort((x, y) => y.score - x.score)
    beam2 = next.slice(0, 12)
    pool.push(...beam2)
  }

  // ── 4. Retour sur la case de la colonne, note complète ──
  pool.sort((a, b) => b.score - a.score)
  const plans: FormationPlan[] = []
  const done = new Set<string>()
  for (const n of pool.slice(0, 80)) {
    const plan = finish(n, true)
    const key = plan.steps.map(describeStep).join(' ')
    if (done.has(key)) continue
    done.add(key)
    plans.push(plan)
  }
  plans.sort((a, b) => b.score - a.score)
  return { plans: plans.slice(0, opts.top ?? 3), evaluated, ms: Date.now() - t0 }
}

/** Monde des bombes (bombes.ts) d'après un état du moteur et les métadonnées des bombes. */
export function bombWorldOf(st: FormationState, s: FightState): BombWorld {
  const w: BombWorld = { walk: c => !!s.map.cells[c]?.walkable, players: [], bombs: [], monsters: new Set(), order: st.players }
  for (const f of s.fighters) {
    if (!f.alive) continue
    const g = st.gameIdOf.get(f.id)
    if (g === undefined) continue
    const b = st.bombs.get(f.id)
    if (b) w.bombs.push({ id: g, owner: b.owner, cell: f.cell, born: b.born, blue: b.blue, alive: true })
    else if (f.kind === 'player') w.players.push({ id: g, cell: f.cell, alive: true })
    else w.monsters.add(f.cell)
  }
  return w
}

/**
 * État du planificateur d'après un instantané (etat.ts : journal ancien format, préréglage « nouveau combat », état
 * édité dans la section web). `anchors` : case de la colonne par identifiant de jeu (défaut : case de début de tour) ;
 * `marks` : cases portant une marque de « Jeu Dangereux » (défaut : celle du Crâ actif, posée au début de son tour).
 */
export function formationStateFromSnapshot(snap: Snapshot, anchors?: Map<number, number>, marks?: number[]): FormationState {
  const b = buildFight(snap)
  const bombs = new Map<number, { owner: number; born: number; blue: boolean }>()
  for (const e of snap.entities) {
    if (e.kind !== 'bomb') continue
    const f = b.byGameId.get(e.gameId)
    if (f) bombs.set(f.id, { owner: e.owner ?? 0, born: e.born ?? snap.round, blue: !!e.blue })
  }
  const crâs = new Set(snap.entities.filter(e => e.kind === 'cra').map(e => e.gameId))
  const active = b.byGameId.get(snap.active)!
  for (const cell of marks ?? [active.cell]) {
    b.fight.traps = [...b.fight.traps, { uid: b.engine.uid(b.fight), sourceId: active.id, spellId: 4873, center: cell, cells: [cell], effects: [], visible: true, color: '#c84' }]
  }
  return { engine: b.engine, fight: b.fight, active: active.id, round: snap.round, gameIdOf: b.gameIdOf, bombs, players: snap.order.filter(g => crâs.has(g)), anchors: anchors ?? new Map(), order: snap.order }
}

// ───────────────────────────── commande ─────────────────────────────

/** Formation du Placement 2 (combat réel du 2026-10-10) : la colonne 327 – 354 – 381 – 408. */
export const FORMATION_PLACEMENT_2: Record<string, number> = { 'Java-Springboot': 327, Lamouit: 354, 'Lowkey-Jealous': 381, 'Kemist-Skyler': 408 }

export function describeStep(x: FStep): string {
  if (x.kind === 'move') return `→${x.path.at(-1)}`
  return `${data.spell(x.spell)?.name ?? x.spell}@${x.cell}`
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('planificateur/formation.ts')) {
  const { measure } = await import('./fidelite')
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const file = arg('--fichier') ?? 'data/fightlogs/2026-10-10/session-08-29-54.jsonl'
  const round = arg('--manche') ? Number(arg('--manche')) : undefined
  const who = arg('--joueur')
  const top = Number(arg('--top') ?? 1)
  const beam = arg('--faisceau') ? Number(arg('--faisceau')) : undefined
  let sumPlan = 0
  let sumReal = 0
  let n = 0
  measure(file, {
    onCraTurn: (state, played) => {
      if (round !== undefined && played.round !== round) return
      if (who && !played.name.toLowerCase().startsWith(who.toLowerCase())) return
      for (const [name, cell] of Object.entries(FORMATION_PLACEMENT_2)) {
        const f = state.fight.fighters.find(x => x.name === name)
        if (f) state.anchors.set(state.gameIdOf.get(f.id)!, cell)
      }
      const res = planFormationTurn(state, { top, beam })
      const realPlan = planFormationTurn(state, { replay: played.steps }).plans[0]
      const best = res.plans[0]
      n++
      sumReal += played.damage
      sumPlan += best ? [...best.damage.values()].reduce((a, x) => a + x, 0) : 0
      console.log(`\nManche ${played.round}, ${played.name} (${res.ms} ms, ${res.evaluated} lancers essayés)`)
      console.log(`  joué  : ${String(played.damage).padStart(5)} dégâts, fin en ${played.endCell} — ${played.steps.map(describeStep).join(', ')}`)
      if (realPlan) console.log(`          note ${Math.round(realPlan.score)} = ${Object.entries(realPlan.parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')} (moteur : ${[...realPlan.damage.values()].reduce((a, x) => a + x, 0)} dégâts)`)
      for (const p of res.plans) {
        const dmg = [...p.damage.values()].reduce((a, x) => a + x, 0)
        const nova = [...p.nova.values()].reduce((a, x) => a + x, 0)
        const thr = p.threats.length ? ` ; menaces ${p.threats.length}${p.threats.some(t => t.spell === DEATH_ROW) ? ' dont Mort en Sursis' : ''}` : ''
        console.log(`  plan  : ${String(dmg).padStart(5)} dégâts${nova ? ` + ${nova} explosions` : ''}, fin en ${p.endCell}${p.atAnchor ? '' : ' (HORS COLONNE)'}${thr}${p.craDeaths.length ? ` ; ${p.craDeaths.length} Crâ(s) tué(s) par bombe` : ''} — ${p.steps.map(describeStep).join(', ')}`)
        console.log(`          note ${Math.round(p.score)} = ${Object.entries(p.parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')}`)
      }
    },
  })
  if (n > 1) console.log(`\n${n} tours : dégâts des sorts joués ${sumReal}, proposés ${sumPlan} (×${(sumPlan / Math.max(1, sumReal)).toFixed(2)})`)
}
