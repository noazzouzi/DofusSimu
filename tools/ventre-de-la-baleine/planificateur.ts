// Planificateur de tour d'un Crâ au Ventre de la Baleine. Les Krobes sont invulnérables et meurent seuls au bout de leur
// compte à rebours : un tour vaut par ce qu'il fait pour les conditions des Krobes, la Malamibe et la survie des Crâs,
// pas par les dégâts en soi. Un tour :
//  1. sorts de soutien depuis sa case (Tirs Puissants, Tirs Éloignés, Acuité Absolue…, tous les sous-ensembles) ;
//  2. une case de tir (classées par le meilleur lancer qu'elles permettent), atteinte en marchant (tacle compris) ;
//  3. faisceau de sorts joués par le vrai moteur (portée, ligne de vue, PA, limites, poussées, jets moyens) ;
//  4. une case de fin, atteinte avec les PM qui restent.
// Note (combat du 2026-10-14 et données 3.7, docs/strategies/ventre-de-la-baleine) :
//  + dommages portés aux Krobes = dommages à la Malamibe (×0,5 si on la vise), plafonnés à ses PV, bonus si elle meurt ;
//    urgence si elle a déjà joué 2 tours ;
//  + éléments reçus par le Pataugerme depuis son dernier tour, s'il les lui faut tous avant son prochain tour (pénalité
//    si le Crâ est le dernier à jouer avant lui et qu'il en manque) ;
//  + Puissance retirée aux monstres (Flèche du Jugement : −150 ≈ −23 % de leurs dommages), selon les dommages évités :
//    pleinement sur un monstre qui peut toucher un Crâ à son prochain tour, peu sur un monstre encore hors d'atteinte
//    (2026-10-14 : 19 Jugements sur un Verminocule qui ne frappait personne, 7 sur les Bacterribs qui tuaient) ;
//  + Pesanteur sur la Virustine quand un Tabacille peut l'échanger ;
//  − menaces des monstres sur la case de fin (dommages mesurés, Puissance comprise) ;
//  − Crâ à 5 cases ou moins d'une Bacterrib (son compte à rebours repart à son début de tour) ;
//  − Verminocule : un gardien, le dernier Crâ à jouer avant lui. Hors d'atteinte, il s'en rapproche (le Verminocule
//    marche vers le Crâ le plus proche) ; à portée, il finit à son contact. Un Crâ qui le peut y va aussi si le gardien
//    ne peut pas, faute de quoi son compte à rebours repart (2026-10-14 : jamais gardé avant la manche 4) ;
//  − Crâs groupés (Brûlure d'estomac en cercle de 2), monstres au contact (tacle), tirs sur nos Crâs ;
//  × interdits : déplacer la Virustine ou viser ses PM, soigner un Crâ tant qu'un Tabacille vit, invoquer (balises).
import { createSpellProfileIndex } from '../../src/ai/core/spellProfile'
import { canCast, castSpell } from '../../src/engine/cast'
import { move, reachableCells } from '../../src/engine/move'
import type { Fighter, FightState, KnownSpell } from '../../src/engine/types'
import { distance, neighborsOf } from '../../src/map/geometry'
import { zoneCells } from '../../src/map/zones'
import { MALAMIBE_PAR_PERSO, MARGE_MULE, MARGE_MULE_TUEUSE } from '../feca/feca'
import type { FStep } from '../reine-des-voleurs/planificateur/formation'
import { applyCastRules } from '../reine-des-voleurs/planificateur/regles'
import { BACTERRIB, ETAT, MALAMIBE, PATAUGERME, PROTOZORREUR, TABACILLE, VERMINOCULE, VIRUSTINE, baseKrobe, isKrobe } from './donjon'
import { upcoming, type EtatCombat } from './etat'
import { threats as threatMap, type Placed } from './menaces'
import type { Moteur } from './moteur'

/**
 * Dommages d'un monstre sur un Crâ à sa portée, en un tour, à Puissance 0. Combats du 2026-10-14 : Pataugerme (Brûlure
 * 170-540 + Attaque souterraine 250-550), Virustine (Boulet ≤ 1 040 + Contamination 280-560), Tabacille (Échange subtil
 * 180-710 + Remontée gastrique 410-590) ; salle 2 : Bacterrib (Sécrétion ×2 et Danse répulsive : 1 100 à 1 600 par
 * tour sur 2 ou 3 Crâs), Verminocule (Gonflement qui attire de 3 cases, puis Jet d'acide ×2 : 800 à 1 600) ; salle
 * annexe : Virustine jusqu'à 2 536 (Boulet Viral 1 373), Pataugerme ≈ 1 500 au contact de 2 Crâs.
 */
export const DANGER: Record<number, number> = {
  [TABACILLE]: 900, [VERMINOCULE]: 1300, [BACTERRIB]: 1100, [VIRUSTINE]: 1500, [PATAUGERME]: 1100, [PROTOZORREUR]: 1500,
}
/** Facteur de dommages d'un monstre selon sa Puissance (caractéristique ≈ 550 en jeu : −150 ≈ −23 %). */
export const powerFactor = (power: number) => Math.max(0.25, Math.min(2, (650 + power) / 650))

/** Sorts écartés : invocations (balises : cases bouchées, et Balise de Survie soigne). */
const HEALS = new Set([32474])
const JUGEMENT = 32460
const ELEMENTS: Record<number, string> = { 1: 'Terre', 2: 'Feu', 3: 'Eau', 4: 'Air' }
const ALL_ELEMENTS = ['Feu', 'Eau', 'Air', 'Terre']

const W = {
  malamibe: 1, malamibeKill: 1500, urgent: 3, mustKill: 60000,
  element: 1500, elementMissing: 5000, elementWasted: 150,
  pesanteur: 2500,
  // Jugement : dommages évités sur les 2 tours de l'effet (−300 de Puissance : Bacterrib de 1 600 à 900 par tour, combat
  // du 2026-10-14 à 16:10) ; ×0,35 sur un monstre qui ne touche encore aucun Crâ.
  jugement: 2.5, jugementFar: 0.35,
  // Contact du Verminocule : contact + bonus du gardien < condition d'une Bacterrib (elle frappe plus fort, de plus
  // loin, et meurt en manche 4 si personne ne l'approche ; le Verminocule seul se gère ensuite) ; le gardien
  // hors d'atteinte perd `approach` par case qui le sépare du contact, et `exposed` s'il finit à portée du Verminocule
  // sans être à son contact (Gonflement l'attire et le frappe sans que la condition soit tenue : Lowkey, −1 484 en M1) ;
  // `contactBroken` : éloigner le Verminocule d'un Crâ qui était à son contact (Java en M2, Flèche de Dispersion).
  threat: 0.6, death: 15000, bacterrib: 8000, bacterribOther: 3000, contact: 6000, tankBonus: 1200, approach: 300,
  exposed: 2500, contactBroken: 3000,
  spread: 300, tackle: 400, friendly: 3, displaced: 800, forbidden: 1e6,
  // Mules (serveur du Féca, opts.joueurs) : comme chez le Féca (tools/feca/planificateur.ts), une mule tuée retire
  // 2 000 PV à la Malamibe en vie, et `mule` pour les suivantes (toujours) ; `muleDamage` par PV retiré à une mule restée
  // en vie. Avant la première Malamibe, frapper un Krobe ne rapporte rien : les mules d'abord.
  mule: 800, muleDamage: 0.3,
  // Tueuse (opts.tueuse ; consigne du joueur, 2026-10-17, comme la mule Lycris de la vidéo) : elle tue les mules à coups
  // de sorts de zone, puis va mourir chez les monstres. Mule tuée : 2 000 (Malamibe) + `mule` ; `tueuseMuleDamage` par PV
  // retiré à une mule ; Krobes comptés à `tueuseKrobes` (sauf Malamibe à tuer) ; fin de tour : `tueuseApproche` par case
  // qui la sépare du Krobe le plus proche (Bacterrib : 3 cases de plus) ; ses propres PV ne comptent pas.
  tueuseMuleDamage: 1, tueuseKrobes: 0.3, tueuseApproche: 150,
}
/**
 * Monstres qui frappent pleinement les Crâs qu'ils atteignent (Verminocule : Gonflement attire de 3 cases, puis Jet
 * d'acide 2 fois au contact) ; les autres répartissent leurs coups entre les Crâs à leur portée.
 */
const FOCUSED = new Set([VERMINOCULE])

export interface BaleinePlan {
  steps: FStep[]
  endCell: number
  score: number
  parts: Record<string, number>
  notes: string[]
}

export interface PlanOptions {
  beam?: number
  maxCasts?: number
  shootCells?: number
  /** Nœuds dont on cherche la meilleure case de fin. */
  finishers?: number
  /** Lancers refusés en jeu pendant ce tour (« sort@case@case du lanceur », « sort@case@* »). */
  forbid?: ReadonlySet<string>
  /** Vol de vie interdit tant qu'un Tabacille vit (non vérifié en jeu, la fiche dit qu'il est permis). */
  noLifesteal?: boolean
  /** Part de la recherche (plusieurs fils) : cases de tir de rang `index` modulo `count`. */
  partition?: { index: number; count: number }
  /**
   * Personnages joués (serveur du Féca, Roc des Salbatroces) : les autres personnages du groupe sont des mules, qui
   * passent leurs tours. Absent : tous les personnages jouent (Crâs de la Baleine).
   */
  joueurs?: readonly string[]
  /** Crâ tueuse (serveur du Féca) : tue les mules, puis va mourir chez les monstres (W.tueuse…). */
  tueuse?: boolean
  /** Sorts d'attaque permis : ceux dont tous les dommages sont de ces éléments (1 Terre, 2 Feu, 3 Eau, 4 Air). */
  elements?: readonly number[]
}

interface Node {
  fight: FightState
  steps: FStep[]
  score: number
  /**
   * Note qui guide la recherche (faisceau, cases de tir) : la note, plus le crédit des éléments donnés au Pataugerme
   * quand il en manquera (dernier Crâ avant lui : seul le 4e élément rapporte, les premiers ouvrent la voie).
   */
  guide: number
  parts: Record<string, number>
  elems: Set<string>
  notes: string[]
  sig: string
}

export function planTourBaleine(st: EtatCombat, mo: Moteur, opts: PlanOptions = {}): { plans: BaleinePlan[]; evaluated: number; ms: number } {
  const t0 = Date.now()
  const { engine } = mo
  const base = engine.cloneFight(mo.fight)
  base.options.rollMode = 'average'
  base.options.forcedCrit = undefined
  const me0 = base.fighters[mo.me]
  const myRid = mo.rid.get(me0.id)!
  const profiles = createSpellProfileIndex(engine)
  const kindOf = (f: Fighter) => (f.monsterId === MALAMIBE ? MALAMIBE : isKrobe(f.monsterId) ? baseKrobe(f.monsterId!) : 0)
  const enemies = (s: FightState) => s.fighters.filter(f => f.alive && f.team !== me0.team && f.cell >= 0)
  const players = (s: FightState) => s.fighters.filter(f => f.alive && f.kind === 'player' && f.cell >= 0)
  const baseEnemies = enemies(base)
  const byKind = (k: number) => baseEnemies.filter(f => kindOf(f) === k)
  const tabacilles = byKind(TABACILLE)
  // (toutes : deux ou trois Virustines par groupe au Roc des Salbatroces)
  const virustines = byKind(VIRUSTINE)
  const pataugerme = byKind(PATAUGERME)[0]
  const verminocules = byKind(VERMINOCULE)
  const bacterribs = byKind(BACTERRIB)
  const malamibe = byKind(MALAMIBE)[0]
  const noLifesteal = opts.noLifesteal ?? true
  let evaluated = 0

  // ── Qui joue avant qui : Crâs entre le Crâ actif et le prochain tour de chaque monstre ──
  const next = upcoming(st, myRid)
  const rOf = (f: Fighter) => mo.rid.get(f.id)
  // Mules (opts.joueurs) : elles passent leurs tours (ni gardiennes, ni aides) ; les tuer réduit la Malamibe.
  const muleIds = new Set(opts.joueurs ? base.fighters.filter(f => f.alive && f.kind === 'player' && f.id !== me0.id && !opts.joueurs!.includes(f.name)).map(f => f.id) : [])
  const muleRids = new Set([...muleIds].map(id => rOf(base.fighters[id])).filter((x): x is number => x !== undefined))
  // (tuées seulement avec de la marge : MARGE_MULE, MARGE_MULE_TUEUSE pour une tueuse)
  for (const id of muleIds) base.fighters[id].hp = Math.ceil(base.fighters[id].hp * (opts.tueuse ? MARGE_MULE_TUEUSE : MARGE_MULE))
  const crasBefore = (f: Fighter | undefined): number[] => {
    if (!f) return []
    const r = rOf(f)
    const out: number[] = []
    for (const id of next) {
      if (id === r) break
      if (st.res.fighters[id]?.kind === 'player' && !muleRids.has(id)) out.push(id)
    }
    return out
  }
  const playsBefore = (craRid: number | undefined, monster: Fighter) => craRid !== undefined && crasBefore(monster).includes(craRid)
  // Gardien de chaque Verminocule (salle annexe : deux) : le dernier Crâ vivant à jouer avant lui dans la manche
  // (personne ne bouge entre la fin de son tour et le début de celui du Verminocule, où la condition est vérifiée).
  const guardianOf = (v: Fighter): number | undefined => {
    const vr = rOf(v)
    const k = vr !== undefined ? st.order.indexOf(vr) : -1
    if (k < 0) return undefined
    for (let j = 1; j < st.order.length; j++) {
      const id = st.order[(k - j + st.order.length) % st.order.length]
      if (st.res.fighters[id]?.kind === 'player' && st.truth.alive.has(id) && !muleRids.has(id)) return id
    }
    return undefined
  }
  const guarding = new Set(verminocules.filter(v => guardianOf(v) === myRid).map(v => v.id))

  // Pataugerme : éléments qui lui manquent avant son prochain tour.
  const pk = pataugerme ? st.krobes.get(rOf(pataugerme)!) : undefined
  const missing = pataugerme ? ALL_ELEMENTS.filter(e => !pk?.elements.has(e)) : []
  const lastBeforeP = pataugerme ? crasBefore(pataugerme).length === 0 : false
  // Malamibe : PV, urgence (2 tours déjà joués : elle tue l'équipe à son prochain tour, ou à celui de son invocateur).
  const malaHp = malamibe ? malamibe.hp : 0
  const urgent = !!malamibe && (st.malamibe?.turnsPlayed ?? 0) >= 2
  const lastBeforeM = !!malamibe && crasBefore(malamibe).length === 0

  const baseHp = new Map(base.fighters.map(f => [f.id, f.alive ? f.hp : 0]))
  const basePower = new Map(baseEnemies.map(f => [f.id, f.stats.power]))
  const baseCell = new Map(base.fighters.map(f => [f.id, f.cell]))

  const usable = me0.spells.filter(sp => profiles.of(sp.level).summons.length === 0 && !HEALS.has(sp.spellId))
  const buffs = usable.filter(sp => sp.level.range === 0 && !profiles.of(sp.level).damage.some(l => l.sides.enemy) && !profiles.of(sp.level).moves.length)
  // (opts.elements : Kyanna-Lee, équipée Eau — 2026-10-17 à 23:43, Flèche d'Abolition, Terre, 60 à 96 par mule ; Œil de
  // Taupe, Eau, 337 à 466)
  const elementsOk = (sp: KnownSpell) => {
    if (!opts.elements) return true
    const d = profiles.of(sp.level).damage
    return d.length > 0 && d.every(l => opts.elements!.includes(l.element))
  }
  const attacks = usable.filter(sp => !buffs.includes(sp) && elementsOk(sp))

  // ── Note des sorts lancés (sans la case de fin) ──
  function castTerms(s: FightState, elems: Set<string>): { score: number; guide: number; parts: Record<string, number> } {
    let mala = 0
    let friendly = 0
    let jugement = 0
    let muleKills = 0
    let muleDmg = 0
    for (const f of s.fighters) {
      const before = baseHp.get(f.id) ?? 0
      if (before <= 0) continue
      const lost = before - (f.alive ? f.hp : 0)
      if (muleIds.has(f.id)) {
        if (!f.alive) muleKills++
        else if (lost > 0) muleDmg += lost
        continue
      }
      // (tueuse : ses propres PV ne comptent pas)
      if (opts.tueuse && f.id === me0.id) continue
      if (f.team === me0.team) {
        if (f.kind === 'player' && lost > 0) friendly -= W.friendly * lost + (!f.alive ? W.forbidden : 0)
        // Allié déplacé par nos sorts (Flèche de Dispersion, combat du 2026-10-14 : trois Crâs repoussés en manche 1).
        if (f.kind === 'player' && f.id !== me0.id && f.alive && baseCell.get(f.id) !== f.cell) friendly -= W.displaced
        continue
      }
      const k = kindOf(f)
      if (k === MALAMIBE) mala += 0.5 * Math.max(0, lost)
      else if (k) mala += Math.max(0, lost)
      if (k && k !== MALAMIBE) {
        const dp = (basePower.get(f.id) ?? 0) - f.stats.power
        if (dp > 0) jugement += (W.jugement * (DANGER[k] ?? 800) * dp * (reaches.has(f.id) ? 1 : W.jugementFar)) / 650
      }
    }
    // (mules tuées : 2 000 PV de moins pour la Malamibe ; tueuse, Malamibe pas encore à tuer : comptés à part, à plein)
    const apart = !!opts.tueuse && !urgent
    if (malamibe && !apart) mala += MALAMIBE_PAR_PERSO * muleKills
    // (toujours : chaque Malamibe suivante aura aussi 2 000 PV de moins)
    const mules = (apart ? MALAMIBE_PAR_PERSO * muleKills : 0) + W.mule * muleKills + (opts.tueuse ? W.tueuseMuleDamage : W.muleDamage) * muleDmg
    let malaScore = 0
    if (malamibe) {
      const got = Math.min(mala, malaHp)
      malaScore = W.malamibe * got * (urgent ? W.urgent : opts.tueuse ? W.tueuseKrobes : 1) + (got >= malaHp ? W.malamibeKill : 0)
      // Dernier Crâ avant l'échéance : elle doit mourir, sinon toute l'équipe meurt.
      if (urgent && lastBeforeM && got < malaHp) malaScore -= W.mustKill
    }
    let elem = 0
    let elemGuide = 0
    if (pataugerme && missing.length) {
      const got = missing.filter(e => elems.has(e)).length
      // Tous reçus avant son tour : condition remplie. Sinon chaque élément renforce sa Brûlure : utile seulement si un
      // Crâ qui joue après celui-ci peut compléter.
      if (got === missing.length) elem = W.element * got + W.element
      else if (!lastBeforeP) elem = W.element * got
      else {
        elem = -W.elementWasted * got
        elemGuide = W.element * got - elem
      }
    }
    let pes = 0
    if (tabacilles.length) {
      for (const v0 of virustines) {
        const v = s.fighters[v0.id]
        if (v.alive && v.states.includes(ETAT.pesanteur) && !base.fighters[v0.id].states.includes(ETAT.pesanteur)) pes += W.pesanteur
      }
    }
    const parts = { malamibe: Math.round(malaScore), elements: elem, jugement: Math.round(jugement), pesanteur: pes, friendly: Math.round(friendly), mules: Math.round(mules) }
    const score = malaScore + elem + jugement + pes + friendly + mules
    return { score, guide: score + elemGuide, parts }
  }

  // ── Note de la case de fin (positions de tous après le tour) ──
  const threatCache = new Map<string, ReturnType<typeof threatMap>>()
  function threatsFor(s: FightState): ReturnType<typeof threatMap> {
    const placed: Placed[] = enemies(s).filter(f => kindOf(f) && kindOf(f) !== MALAMIBE).map(f => ({ monsterId: f.monsterId!, cell: f.cell }))
    const cras = players(s).filter(f => f.id !== me0.id).map(f => f.cell)
    const key = placed.map(p => `${p.monsterId}@${p.cell}`).join(',') + '|' + cras.join(',')
    let t = threatCache.get(key)
    if (!t) threatCache.set(key, (t = threatMap(s.map, placed, cras)))
    return t
  }
  // Monstres qui peuvent toucher un Crâ à leur prochain tour (zones de menaces depuis les cases du début du tour).
  const reaches = new Set<number>()
  {
    const t = threatsFor(base)
    for (const c of players(base)) for (const src of t.sources.get(c.cell) ?? []) {
      const m = baseEnemies.find(f => f.cell === src)
      if (m) reaches.add(m.id)
    }
  }

  function endTerms(s: FightState, end: number): { score: number; parts: Record<string, number>; notes: string[] } {
    const notes: string[] = []
    // Tueuse : finir au plus près des Krobes (Bacterrib : 3 cases de plus), pour s'y faire tuer.
    if (opts.tueuse) {
      let near = Infinity
      for (const m of enemies(s)) {
        const k = kindOf(m)
        if (!k || k === MALAMIBE) continue
        near = Math.min(near, distance(end, m.cell) + (k === BACTERRIB ? 3 : 0))
      }
      const approche = Number.isFinite(near) ? -W.tueuseApproche * near : 0
      notes.push(`tueuse : fin à ${Number.isFinite(near) ? near : '?'} case(s) d'un Krobe`)
      return { score: approche, parts: { approche }, notes }
    }
    const t = threatsFor(s)
    const mons = enemies(s)
    // Verminocules : un Crâ au contact de chacun au début de son tour.
    let contact = 0
    /** Verminocules au contact desquels ce Crâ finit son tour. */
    const tankOf = new Set<number>()
    const others = players(s).filter(c => c.id !== me0.id)
    for (const vf of verminocules) {
      const v = s.fighters[vf.id]
      if (!v.alive) continue
      // (un Crâ qui joue avant le Verminocule peut encore partir ou venir : seuls comptent ceux qui ne rejouent pas avant)
      const stays = others.filter(c => distance(c.cell, v.cell) === 1 && !playsBefore(rOf(c), v))
      const tank = distance(end, v.cell) === 1
      if (tank) tankOf.add(v.id)
      // (serveur du Féca, opts.joueurs : le contact des Verminocules est l'affaire du Féca, en phase de tank ; le Crâ, 8 PA
      // et 2 000 PV, n'a pas à le tenir — 2026-10-17 au soir : Kyanna-Lee tirée vers eux, −7 000 à −18 600 de contact)
      if (!stays.length && !opts.joueurs) {
        // Crâs qui jouent après celui-ci et avant le Verminocule, et qui peuvent encore aller à son contact.
        const helpers = crasBefore(v).filter(r => r !== myRid).filter(r => {
          const c = s.fighters[mo.eid.get(r) ?? -1]
          return c?.alive && distance(c.cell, v.cell) - 1 <= Math.max(0, c.stats.mp)
        })
        if (tank) contact += W.tankBonus
        else if (!helpers.length) {
          contact -= W.contact
          notes.push('Verminocule sans Crâ au contact')
        }
        // Gardien encore loin : se rapprocher (le Verminocule marche vers le Crâ le plus proche), sans finir à sa portée.
        if (guarding.has(v.id) && !tank) {
          contact -= W.approach * Math.max(0, distance(end, v.cell) - 1)
          if ([...(t.sources.get(end) ?? [])].includes(v.cell)) {
            contact -= W.exposed
            notes.push('gardien à portée du Verminocule sans être à son contact')
          }
        }
      }
      // Contact cassé : un Crâ était à son contact au début du tour, et plus personne ne l'est (Verminocule ou Crâ déplacé).
      const vStart = baseCell.get(v.id) ?? v.cell
      const held = players(base).some(c => c.id !== me0.id && distance(c.cell, vStart) === 1)
      if (held && !tank && !others.some(c => distance(c.cell, v.cell) === 1)) {
        contact -= W.contactBroken
        notes.push('contact du Verminocule cassé')
      }
    }
    // Menaces de leur prochain tour sur la case de fin : dommages attendus, pondérés par les PV qui restent ; mort
    // probable si leur somme dépasse les PV du Crâ (Lowkey et Kemist, morts aux manches 2 et 3 le 2026-10-14).
    // Part de chaque monstre : ses coups se répartissent entre les Crâs qu'il peut toucher (2026-10-14 : chaque Bacterrib
    // a visé 1 à 3 Crâs par tour), au moins la moitié pour garder une marge.
    const otherCells = players(s).filter(c => c.id !== me0.id).map(c => c.cell)
    let threat = 0
    let expected = 0
    for (const cell of t.sources.get(end) ?? []) {
      const m = mons.find(f => f.cell === cell)
      if (!m) continue
      const k = kindOf(m)
      const targets = 1 + otherCells.filter(c => [...(t.sources.get(c) ?? [])].includes(cell)).length
      const dmg = ((DANGER[k] ?? 800) * powerFactor(m.stats.power)) * (FOCUSED.has(k) ? 1 : Math.max(0.5, 1 / targets))
      expected += dmg
      // (au contact du Verminocule, ses coups sont le prix de la condition : ils comptent pour la mort possible seulement)
      if (k === VERMINOCULE && tankOf.has(m.id)) continue
      threat -= W.threat * dmg
    }
    const me = s.fighters[me0.id]
    // (PV sans les soins du tour : le vol de vie du moteur porte aussi sur les Krobes, qui ne perdent rien en jeu)
    const myHp = Math.min(me.hp, baseHp.get(me0.id) ?? me.hp)
    const frail = 1 + 2 * Math.max(0, 1 - myHp / Math.max(1, me.maxHp))
    threat *= frail
    if (expected >= myHp) {
      threat -= W.death
      notes.push(`mort possible (≈ ${Math.round(expected)} dommages attendus pour ${myHp} PV)`)
    }
    // Bacterribs : aucun Crâ à 5 cases ou moins à leur début de tour. Les autres Crâs : écart avec le début du tour
    // (une Bacterrib repoussée loin du Crâ qui garde le Verminocule compte ; un Crâ qui rejoue avant elle peut s'en
    // charger lui-même, d'où un poids réduit).
    let bact = 0
    for (const b0 of bacterribs) {
      const b = s.fighters[b0.id]
      if (!b.alive) continue
      if (distance(end, b.cell) <= 5) {
        bact -= W.bacterrib
        notes.push(`à ${distance(end, b.cell)} case(s) d'une Bacterrib`)
      }
      for (const c of players(s)) {
        if (c.id === me0.id) continue
        const was = distance(baseCell.get(c.id) ?? c.cell, baseCell.get(b.id) ?? b.cell) <= 5
        const is = distance(c.cell, b.cell) <= 5
        if (was === is) continue
        bact += (was ? 1 : -1) * (playsBefore(rOf(c), b) ? W.bacterribOther / 3 : W.bacterribOther)
      }
    }
    // Crâs groupés (Brûlure d'estomac du Pataugerme, cercle de 2).
    let spread = 0
    if (pataugerme && s.fighters[pataugerme.id].alive) for (const c of players(s)) if (c.id !== me0.id && distance(c.cell, end) <= 2) spread -= W.spread
    // Monstres au contact (tacle au prochain tour), sauf le Verminocule du Crâ qui le garde.
    let tackle = 0
    for (const m of mons) if (distance(m.cell, end) === 1 && !tankOf.has(m.id) && kindOf(m) !== MALAMIBE) tackle -= W.tackle
    const parts = { threat: Math.round(threat), bacterrib: bact, contact, spread, tackle }
    return { score: threat + bact + contact + spread + tackle, parts, notes }
  }

  // ── Règles du donjon sur un lancer (après simulation) ──
  function forbidden(before: FightState, after: FightState, sp: KnownSpell, cell: number): string | null {
    for (const virustine of virustines) {
      const v0 = before.fighters[virustine.id]
      const v1 = after.fighters[virustine.id]
      if (v0.alive && v1.alive && v0.cell !== v1.cell) return 'déplace la Virustine'
      const p = profiles.of(sp.level)
      const from = before.fighters[me0.id].cell
      for (const l of p.removals) {
        if (l.pool !== 'mp' || !l.sides.enemy) continue
        if (zoneCells(l.zone, cell, from).includes(v0.cell)) return 'vise les PM de la Virustine'
      }
    }
    if (tabacilles.length) {
      for (const f of after.fighters) {
        if (f.team !== me0.team || f.kind !== 'player') continue
        const hpBefore = before.fighters[f.id].hp
        if (f.hp > hpBefore && (noLifesteal || f.id !== me0.id)) return 'soigne un Crâ (Tabacille)'
      }
    }
    return null
  }

  const sigOf = (s: FightState, steps: FStep[]) => {
    const m = s.fighters[me0.id]
    const casts = steps.filter(x => x.kind === 'cast').map(x => `${(x as { spell: number }).spell}@${(x as { cell: number }).cell}`).sort().join(',')
    const pos = s.fighters.filter(f => f.alive && f.id !== me0.id).map(f => `${f.cell}:${f.hp}`).join(',')
    return `${m.cell}|${m.ap}|${m.mp}|${casts}|${pos}`
  }

  function node(s: FightState, steps: FStep[], elems: Set<string>, notes: string[]): Node {
    const c = castTerms(s, elems)
    return { fight: s, steps, score: c.score, guide: c.guide, parts: c.parts, elems, notes, sig: sigOf(s, steps) }
  }

  function cast(n: Node, sp: KnownSpell, cell: number): Node | null {
    const m = n.fight.fighters[me0.id]
    // (« sort@*@* » : refusé pour un état, écarté pour tout le tour)
    if (opts.forbid?.has(`${sp.spellId}@${cell}@${m.cell}`) || opts.forbid?.has(`${sp.spellId}@${cell}@*`) || opts.forbid?.has(`${sp.spellId}@*@*`)) return null
    if (canCast(engine, n.fight, m, sp, cell) !== null) return null
    // (événements enregistrés : éléments des dommages reçus par le Pataugerme)
    const s = engine.cloneFightForSim(n.fight, true)
    const target = s.fighters.find(f => f.alive && f.cell === cell && f.id !== me0.id)
    const from = s.events.length
    evaluated++
    if (!castSpell(engine, s, s.fighters[me0.id], sp.spellId, cell).ok || !s.fighters[me0.id].alive) return null
    // PM volés (Flèche d'Immobilisation) : esquivés 4 fois sur 4 le 2026-10-14, jamais comptés pour la marche qui suit.
    if (s.fighters[me0.id].mp > m.mp) s.fighters[me0.id].mp = m.mp
    applyCastRules(engine, s, s.fighters[me0.id], sp.spellId)
    const why = forbidden(n.fight, s, sp, cell)
    if (why) return null
    // Éléments reçus par le Pataugerme (toute ligne de dommages élémentaires, même faible).
    let elems = n.elems
    if (pataugerme) {
      for (let k = from; k < s.events.length; k++) {
        const e = s.events[k]
        if (e.t !== 'damage' || e.target !== pataugerme.id) continue
        const name = ELEMENTS[e.element as number]
        if (name && !elems.has(name)) elems = new Set([...elems, name])
      }
    }
    const tg = target ? rOf(target) : undefined
    return node(s, [...n.steps, { kind: 'cast', spell: sp.spellId, cell, target: tg }], elems, n.notes)
  }

  function walk(n: Node, to: number): Node | null {
    const s = engine.cloneFightForSim(n.fight)
    const m = s.fighters[me0.id]
    if (m.cell === to) return n
    const r = reachableCells(s, m, engine, m.mp)
    if (!r.cost.has(to)) return null
    const path = [to]
    while (path[0] !== m.cell) {
      const p = r.prev.get(path[0])
      if (p === undefined) return null
      path.unshift(p)
    }
    move(s, m, path, engine)
    if (m.cell !== to) return null
    return node(s, [...n.steps, { kind: 'move', path }], n.elems, n.notes)
  }

  /** Cases cibles d'un sort : ennemis (et leurs voisines pour les zones) ; soi pour les sorts de portée 0. */
  function targetsFor(s: FightState, sp: KnownSpell, from: number): number[] {
    if (sp.level.range === 0) return [from]
    const p = profiles.of(sp.level)
    const cells = new Set<number>()
    // (et les mules, à achever)
    for (const e of [...enemies(s), ...s.fighters.filter(f => f.alive && muleIds.has(f.id))]) {
      cells.add(e.cell)
      if (p.zoneRadius > 0 || p.needFreeCell) for (const c of neighborsOf(e.cell)) cells.add(c)
    }
    const max = sp.level.range + (sp.level.rangeBoostable ? Math.max(0, s.fighters[me0.id].stats.range) : 0) + 12
    return [...cells].filter(c => c >= 0 && distance(from, c) <= max)
  }

  // ── 1. Départs : sorts de soutien (tous les sous-ensembles) ──
  let roots: Node[] = [node(base, [], new Set(), [])]
  for (const bf of buffs) {
    const more: Node[] = []
    for (const r of roots) {
      const x = cast(r, bf, r.fight.fighters[me0.id].cell)
      if (x) more.push(x)
    }
    roots = roots.concat(more)
  }

  // ── 2. Cases de tir, classées par le meilleur lancer qu'elles permettent ──
  const rankCache = new Map<number, number>()
  function bestFrom(r: Node, cell: number): number {
    const s = engine.cloneFightForSim(r.fight)
    s.fighters[me0.id].cell = cell
    const probe: Node = { ...r, fight: s }
    let best = 0
    for (const sp of attacks) {
      for (const c of targetsFor(s, sp, cell)) {
        const x = cast(probe, sp, c)
        if (x) best = Math.max(best, x.guide - r.guide)
      }
    }
    return best
  }
  const keepCells = opts.shootCells ?? 8
  let frontier: Node[] = []
  const reach0 = reachableCells(base, me0, engine, me0.mp)
  const scored: { cell: number; v: number }[] = []
  for (const [cell, cost] of reach0.cost) {
    let v = rankCache.get(cell)
    if (v === undefined) rankCache.set(cell, (v = bestFrom(roots[0], cell)))
    scored.push({ cell, v: v - cost * 1 })
  }
  scored.sort((a, b) => b.v - a.v)
  const keep = scored.slice(0, keepCells).map(x => x.cell)
  if (!keep.includes(me0.cell)) keep.push(me0.cell)
  const part = opts.partition && opts.partition.count > 1 ? opts.partition : undefined
  const kept = part ? keep.filter((_, i) => i % part.count === part.index) : keep
  for (const r of roots) for (const c of kept) {
    const x = c === r.fight.fighters[me0.id].cell ? r : walk(r, c)
    if (x) frontier.push(x)
  }

  // ── 3. Faisceau de lancers ──
  // (16 jusqu'au 2026-10-14 : Représailles en plus, ses variantes chassaient la meilleure suite de Java en salle 1)
  const beamWidth = opts.beam ?? 32
  const maxCasts = opts.maxCasts ?? 5
  const minCost = Math.min(...attacks.map(sp => sp.level.apCost))
  const pool: Node[] = [...frontier]
  const seen = new Set(frontier.map(x => x.sig))
  let beam = frontier
  for (let depth = 0; depth < maxCasts; depth++) {
    const nextNodes: Node[] = []
    for (const n of beam) {
      const from = n.fight.fighters[me0.id].cell
      for (const sp of attacks) {
        for (const cell of targetsFor(n.fight, sp, from)) {
          const x = cast(n, sp, cell)
          if (!x || seen.has(x.sig)) continue
          seen.add(x.sig)
          nextNodes.push(x)
        }
      }
    }
    if (!nextNodes.length) break
    nextNodes.sort((a, b) => b.guide - a.guide)
    // Candidats de fin : les meilleurs de cette profondeur, même hors du faisceau (un tour fini à 0 PA est complet).
    pool.push(...nextNodes.slice(0, 3 * beamWidth))
    // Faisceau : les nœuds qui peuvent encore lancer un sort (2026-10-14, salle 1 : des variantes à 0 PA, mêmes sorts
    // depuis des cases voisines après un tacle, avaient chassé la meilleure suite du faisceau).
    beam = diverse(nextNodes.filter(n => n.fight.fighters[me0.id].ap >= minCost), beamWidth)
    if (!beam.length) break
  }

  function diverse(nodes: Node[], width: number): Node[] {
    const out: Node[] = []
    const keys = new Set<string>()
    for (const n of nodes) {
      if (out.length >= 2 * width) break
      const spells = n.steps.filter(x => x.kind === 'cast').map(x => (x as { spell: number }).spell).sort().join(',')
      const k = `${n.fight.fighters[me0.id].cell}|${spells}`
      if (keys.has(k)) continue
      keys.add(k)
      out.push(n)
    }
    for (const n of nodes) {
      if (out.length >= width) break
      if (!out.includes(n)) out.push(n)
    }
    return out
  }

  // ── 4. Case de fin : les meilleurs nœuds par la note, et quelques-uns par le guide ──
  const finishers = opts.finishers ?? 40
  const byScore = [...pool].sort((a, b) => b.score - a.score).slice(0, finishers)
  const byGuide = [...pool].sort((a, b) => b.guide - a.guide).filter(n => !byScore.includes(n)).slice(0, Math.ceil(finishers / 4))
  const plans: BaleinePlan[] = []
  const done = new Set<string>()
  for (const n of [...byScore, ...byGuide]) {
    const s = n.fight
    const m = s.fighters[me0.id]
    const r = reachableCells(s, m, engine, Math.max(0, m.mp))
    let best: { node: Node; end: ReturnType<typeof endTerms>; total: number } | null = null
    for (const cell of r.cost.keys()) {
      const w = cell === m.cell ? n : walk(n, cell)
      if (!w) continue
      const end = endTerms(w.fight, w.fight.fighters[me0.id].cell)
      const total = w.score + end.score - 0.5 * (w.steps.length - n.steps.length)
      if (!best || total > best.total) best = { node: w, end, total }
    }
    if (!best) continue
    const key = best.node.steps.map(x => (x.kind === 'move' ? `>${x.path.at(-1)}` : `${x.spell}@${x.cell}`)).join(' ')
    if (done.has(key)) continue
    done.add(key)
    plans.push({
      steps: best.node.steps, endCell: best.node.fight.fighters[me0.id].cell, score: Math.round(best.total),
      parts: { ...best.node.parts, ...best.end.parts }, notes: [...best.node.notes, ...best.end.notes],
    })
  }
  plans.sort((a, b) => b.score - a.score)
  return { plans: plans.slice(0, 3), evaluated, ms: Date.now() - t0 }
}

/** Ligne de journal d'un pas du plan. */
export function decrirePas(x: FStep, nom: (spellId: number) => string): string {
  if (x.kind === 'move') return `→${x.path.at(-1)}`
  return `${nom(x.spell)}@${x.cell}`
}
