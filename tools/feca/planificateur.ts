// Planificateur de tour d'un Féca contre les Krobes (Roc des Salbatroces, Ventre de la Baleine), seul ou en groupe.
// Même recherche que celui des Crâs (tools/ventre-de-la-baleine/planificateur.ts) : sorts de soutien depuis sa case,
// une case de tir, un faisceau de sorts joués par le vrai moteur, une case de fin. Les Krobes sont invulnérables et
// meurent seuls au bout de leur compte à rebours : un tour vaut par ce qu'il fait pour leurs conditions, la Malamibe
// et la survie du Féca. Synthèse : docs/strategies/krobes-feca/README.md.
// Deux phases (stratégie de la vidéo de référence, 2026-10-17) :
//  - FUITE, tant qu'un Krobe autre que les Verminocules vit : rester hors d'atteinte pour qu'ils meurent tous au début
//    de la manche 4 ; le Verminocule est ignoré (sa relance ne coûte qu'un délai), sa menace compte comme les autres ;
//  - TANK, quand il ne reste que des Verminocules : à leur contact, Barricade d'abord, puis Bouclier Féca, Défiance,
//    Ataraxie… (combat du 2026-10-17 : Féca allé au contact du Verminocule dès la manche 1, à 4 cases des Bacterribs,
//    mort en manche 4).
//  + dommages portés aux Krobes = dommages à la Malamibe (×0,5 si on la vise), plafonnés à ses PV, bonus si elle meurt ;
//    urgence si elle a déjà joué 2 tours (elle tue alors toute l'équipe) ;
//  + PA retirés aux Krobes : leurs attaques coûtent 4 PA, une attaque de moins par palier (Terre Battue, Somnolence…) ;
//  + Pesanteur sur la Virustine quand un Tabacille peut l'échanger (Barrière, Bergerie) ;
//  + éléments reçus par le Pataugerme (Ventre de la Baleine) ;
//  − menaces des monstres sur la case de fin, réduites par ses protections (Barricade au contact du Verminocule…),
//    sauf celles d'un tour qu'une Bacterrib retire avant leur tour ;
//  − à 5 cases ou moins d'une Bacterrib ; Verminocule sans personne à son contact ; monstres au contact (tacle) ;
//  × interdits : déplacer la Virustine ou viser ses PM, soigner tant qu'un Tabacille vit, invoquer (Lanterne du
//    Berger des glyphes, boucliers) à 5 cases ou moins d'une Bacterrib.
import { createSpellProfileIndex } from '../../src/ai/core/spellProfile'
import { canCast, castSpell } from '../../src/engine/cast'
import { marksTurnEnd } from '../../src/engine/effects/marks'
import { move, reachableCells } from '../../src/engine/move'
import type { Fighter, FightState, KnownSpell } from '../../src/engine/types'
import { distance, inLine, neighborsOf } from '../../src/map/geometry'
import { zoneCells } from '../../src/map/zones'
import type { FStep } from '../reine-des-voleurs/planificateur/formation'
import { applyCastRules } from '../reine-des-voleurs/planificateur/regles'
import { BACTERRIB, ETAT, KROBES, MALAMIBE, PATAUGERME, TABACILLE, VERMINOCULE, VIRUSTINE, baseKrobe, isKrobe } from '../ventre-de-la-baleine/donjon'
import { upcoming, type EtatCombat } from '../ventre-de-la-baleine/etat'
import { threats as threatMap, type Placed } from '../ventre-de-la-baleine/menaces'
import type { Moteur } from '../ventre-de-la-baleine/moteur'
import { powerFactor, type BaleinePlan, type PlanOptions } from '../ventre-de-la-baleine/planificateur'
import {
  ARME, BRULURE_PAR_ELEMENT, DANGER_FECA, ECARTES, ECHANGES_PAR_TOUR, INEBRANLABLE, JOUEURS, LANTERNE, LEURRE, MALAMIBE_PAR_PERSO, MARGE_MULE, TUEUSES, MALAMIBE_PV, MELEE, PA_ATTAQUE, SINGE_ET_LUNE, SOIN_PERIODE, PORTEE_ATTAQUE, PORTEE_ECHANGE, PORTEE_REMONTEE,
  PROTECTIONS, SORT, TELEPORTS, attaquesDe, type Protection,
} from './feca'

const ELEMENTS: Record<number, string> = { 1: 'Terre', 2: 'Feu', 3: 'Eau', 4: 'Air' }
const ALL_ELEMENTS = ['Feu', 'Eau', 'Air', 'Terre']

/** Poids de la note (mêmes échelles que le planificateur des Crâs). */
export const W = {
  malamibe: 1, malamibeKill: 1500, urgent: 3, mustKill: 60000,
  // Malamibe à son 1er tour : dommages comptés moins (la tuer tout de suite force à tuer la suivante plus tôt, et prend
  // les PA des protections) ; pénalité par PV qu'elle garderait au-delà de ce que le Féca pourra lui faire au tour
  // suivant (`capSafety` × ses meilleurs dommages de ce tour).
  malamibeEarly: 0.4, deadline: 10, capSafety: 0.8,
  // Malamibe à tuer : sûrement tuée au-delà de `killMargin` × ses PV (dommages prévus aux jets moyens, 1 à 9 % au-dessus
  // des vrais ; 2026-10-17, Roc des Salbatroces : deux morts d'un coup, Malamibe ratée de peu, 4 PA inutilisés) ;
  // `marginPenalty` par PV qui manque pour atteindre la marge.
  killMargin: 1.25, marginPenalty: 20,
  // Malamibe à tuer ce tour, avec un joueur (Kyanna-Lee) qui joue après le Féca et avant elle : il en attend
  // `allieMalamibe` dommages et vise le reste (× killMargin), `marginPenalty` par PV qui manque. 2026-10-18 : Kyanna-Lee
  // lui fait 1 160 à 1 600 au tour 2 ; combat de 17:23 perdu de 87 PV, le Féca ayant lancé Bergerie au lieu d'une Bulle
  // (sans elle, il ne visait rien : la mise à mort n'était pas à sa portée seul).
  allieMalamibe: 1100,
  // Pataugerme : ses 4 éléments ne valent qu'une manche de gagnée (1 500 par élément chez les Crâs, à quatre pour les
  // donner ; 2026-10-17, salle annexe : Féca venu les lui donner en manche 4, encerclé en manche 5, −2 024 PV).
  element: 250, elementMissing: 5000, elementWasted: 100,
  pesanteur: 2500,
  // PA retirés : dommages évités (une attaque sur trois par palier de 4 PA), ×0,35 sur un Krobe qui ne touche personne.
  pa: 1.5, paFar: 0.35,
  // Dommages subis : 1,5 point par PV (le Féca seul n'a personne pour les partager, et les PV perdus se paient au combat
  // suivant ; 0,6 chez les Crâs). `trap` : par dommage que le Féca ne pourra pas éviter au tour suivant (encerclé).
  // `reserve` : protection à longue relance lancée maintenant, par dommage qu'elle aurait évité au tour suivant (plus
  // dangereux) — 2026-10-17, salle annexe : toutes lancées en manches 2 à 4, aucune en manche 5 (−2 024 PV).
  // (Pesanteur contre l'Échange subtil des Tabacilles : prévu dans les coups attendus, endTerms)
  threat: 1.5, trap: 0.75, reserve: 1.2, death: 15000, bacterrib: 8000, contact: 6000, tankBonus: 1200, approach: 300, exposed: 2500,
  contactBroken: 3000, tackle: 400, friendly: 3,
  // Mules : chacune tuée retire 2 000 PV à la Malamibe en vie (comptés comme dommages sur elle), et à toutes les
  // suivantes : `mule` par mule tuée, toujours (au taux d'une Malamibe à son 1er tour, 0,4 × 2 000) ; avant la première
  // Malamibe (1er tour, si le Féca joue avant les Krobes), frapper un Krobe ne sert à rien, une mule si. `muleDamage` par
  // PV retiré à une mule restée en vie : les Krobes l'achèveront le plus souvent (mules du joueur : 1 000 à 2 000 PV,
  // 2026-10-17). `muleBacterrib` : mule à 5 cases ou moins d'une Bacterrib à la fin du tour (relancée à son tour si la
  // mule vit encore ; vidéo, manche 1).
  // `muleDamage` : chaque PV retiré rapproche sa mort, que les Krobes ou Kyanna-Lee achèvent (consigne : toutes les mules
  // mortes à la fin de la manche 1 ; Bulle, le seul sort du Féca qui touche les alliés).
  // `krobesAvecMules` : poids des dommages sur les Krobes tant que des mules vivent. 0,1 du 2026-10-17 à 23:55 au
  // 2026-10-18 à 00:15 ; remis à 1 : ces dommages restent acquis sur la Malamibe, et Bulle ne se lance que 3 fois par tour
  // (2 par cible) — les PA qui restent servent mieux sur les Krobes (combat de 00:14 perdu d'environ 170 PV).
  mule: 800, muleDamage: 1, muleBacterrib: 3000, krobesAvecMules: 1,
  // Tueuse (TUEUSES, consigne du joueur : « Féca à son 1er tour va attaquer Kyanna-Lee pour lui réduire ses points de
  // vie ») : `tueuse` par PV retiré, jusqu'à lui en laisser `tueuseReste` (part de ses PV max) ; `tueuseMort` si elle meurt
  // avant d'avoir tué les mules.
  tueuse: 1, tueuseReste: 0.25, tueuseMort: 20000,
}

export type FecaPlan = BaleinePlan

interface Node {
  fight: FightState
  steps: FStep[]
  score: number
  guide: number
  /** Dommages faits à la Malamibe pendant ce tour (plafonnés à ses PV). */
  mala: number
  /** Les mêmes, sans le plafond de ses PV. */
  malaRaw: number
  parts: Record<string, number>
  /** Éléments donnés pendant ce tour à chaque Pataugerme (identifiant du moteur). */
  elems: Map<number, Set<string>>
  notes: string[]
  sig: string
}

export function planTourFeca(st: EtatCombat, mo: Moteur, opts: PlanOptions = {}): { plans: FecaPlan[]; evaluated: number; ms: number } {
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
  const rOf = (f: Fighter) => mo.rid.get(f.id)
  // Mules (personnages du groupe absents de JOUEURS) : elles passent leurs tours, ne viendront donc au
  // contact de personne ; vivantes, elles prennent leur part des coups et ajoutent 2 000 PV chacune à la Malamibe.
  const muleIds = new Set(base.fighters.filter(f => f.alive && f.kind === 'player' && f.id !== me0.id && !JOUEURS.includes(f.name)).map(f => f.id))
  const muleRids = new Set([...muleIds].map(id => rOf(base.fighters[id])).filter((x): x is number => x !== undefined))
  /** Mules (hors tueuses) en vie au début du tour. */
  const mulesEnVie = muleIds.size > 0
  // Tueuses (TUEUSES) : tant qu'une mule vit, le Féca entame leurs PV sans les tuer (elles doivent encore jouer, pour tuer
  // les mules) ; sans mule en vie, ce sont des mules comme les autres.
  const tueuseIds = new Set<number>()
  for (const f of base.fighters.filter(f => f.alive && f.kind === 'player' && f.id !== me0.id && TUEUSES.includes(f.name))) {
    if (muleIds.size) tueuseIds.add(f.id)
    else {
      muleIds.add(f.id)
      const r = rOf(f)
      if (r !== undefined) muleRids.add(r)
    }
  }
  // (tuées seulement avec de la marge : MARGE_MULE)
  for (const id of muleIds) base.fighters[id].hp = Math.ceil(base.fighters[id].hp * MARGE_MULE)
  // ── Krobes condamnés : leur compte à rebours expire au début de leur prochain tour, ils meurent sans jouer (la mort
  // passe avant la relance : 2026-10-17, Pataugerme mort en manche 5 sans ses 4 éléments). Ni menace, ni condition à
  // tenir ; la Malamibe qu'ils ont invoquée meurt avec eux. (La Virustine et les Tabacilles restent à ne pas déplacer
  // ni soigner : leur relance est immédiate et les sauverait.)
  const myIdx = st.order.indexOf(myRid)
  // Soins de « Le Singe et la Lune » (début de ses tours 3, 6, 9…) : les Tabacilles repartent à chacun, pendant son tour.
  const soigne = st.res.replay.events.some(e => e.t === 'cast' && e.fighter === myRid && e.spellId === SINGE_ET_LUNE)
  const lastHeal = soigne ? Math.floor(st.round / SOIN_PERIODE) * SOIN_PERIODE : 0
  const condamne = (f: Fighter): boolean => {
    const rid = rOf(f)
    const ks = rid !== undefined ? st.krobes.get(rid) : undefined
    if (!ks?.lastReset) return false
    const reset = baseKrobe(f.monsterId!) === TABACILLE && lastHeal > ks.lastReset.round ? { round: lastHeal, during: myRid } : ks.lastReset
    const death = reset.round + (KROBES[f.monsterId!]?.tours ?? 3)
    const idx = st.order.indexOf(rid!)
    // (encore en vie après la mort attendue : une relance que le journal n'a pas vue)
    if (death < st.round || (death === st.round && idx >= 0 && idx < myIdx)) return false
    const nextRound = idx > myIdx ? st.round : st.round + 1
    return death < nextRound || (death === nextRound && (reset.during === undefined || reset.during === rid))
  }
  const condamnes = new Set(baseEnemies.filter(f => isKrobe(f.monsterId) && condamne(f)).map(f => f.id))
  for (const f of baseEnemies) if (f.monsterId === MALAMIBE && f.summonerId !== undefined && condamnes.has(f.summonerId)) condamnes.add(f.id)
  const active = (f: Fighter) => !condamnes.has(f.id)
  const byKind = (k: number) => baseEnemies.filter(f => kindOf(f) === k)
  const tabacilles = byKind(TABACILLE)
  // (toutes : 2026-10-17, deux Virustines au Roc des Salbatroces, seule la première était protégée)
  const virustines = byKind(VIRUSTINE)
  const pataugermes = byKind(PATAUGERME).filter(active)
  const verminocules = byKind(VERMINOCULE).filter(active)
  const bacterribs = byKind(BACTERRIB).filter(active)
  // (Malamibe d'un Krobe condamné : toujours à tuer — si sa relance échappe au journal, ou si l'explosion passe avant sa
  // mort, elle tue tout le monde ; 2026-10-17 à 13:26 avec une Tabacille, 2026-10-18 à 18:36 avec une Virustine : Malamibe
  // de 2 001 PV laissée en vie au tour où elle explosait, Féca en protections.)
  const malamibe = byKind(MALAMIBE).find(active) ?? byKind(MALAMIBE)[0]
  /** Phase de fuite : un Krobe autre qu'un Verminocule vit encore et jouera (sinon : phase de tank). */
  const fuite = baseEnemies.some(f => {
    const k = kindOf(f)
    return active(f) && k !== 0 && k !== MALAMIBE && k !== VERMINOCULE
  })
  let evaluated = 0

  // ── Qui joue avant qui : personnages entre le Féca et le prochain tour de chaque monstre ──
  const next = upcoming(st, myRid)
  const rank = (f: Fighter) => {
    const k = next.indexOf(rOf(f) ?? -1)
    return k < 0 ? next.length : k
  }
  const playersBefore = (f: Fighter | undefined): number[] => {
    if (!f) return []
    const out: number[] = []
    for (const id of next) {
      if (id === rOf(f)) break
      if (st.res.fighters[id]?.kind === 'player' && !muleRids.has(id)) out.push(id)
    }
    return out
  }
  const playsBefore = (rid: number | undefined, monster: Fighter) => rid !== undefined && playersBefore(monster).includes(rid)
  // Gardien de chaque Verminocule : le dernier personnage vivant à jouer avant lui (seul : le Féca).
  const guardianOf = (v: Fighter): number | undefined => {
    const vr = rOf(v)
    const k = vr !== undefined ? st.order.indexOf(vr) : -1
    if (k < 0) return myRid
    for (let j = 1; j < st.order.length; j++) {
      const id = st.order[(k - j + st.order.length) % st.order.length]
      if (st.res.fighters[id]?.kind === 'player' && st.truth.alive.has(id) && !muleRids.has(id)) return id
    }
    return undefined
  }
  const guarding = new Set(verminocules.filter(v => guardianOf(v) === myRid).map(v => v.id))

  // Pataugermes (salle 4 : deux) : éléments reçus depuis leur dernier tour, ceux qui leur manquent, et s'il ne reste
  // personne pour les compléter avant leur tour. Chaque élément reçu ajoute une ligne à leur prochaine Brûlure.
  const pataInfo = new Map(pataugermes.map(p => {
    const before = st.krobes.get(rOf(p)!)?.elements ?? new Set<string>()
    return [p.id, { before, missing: ALL_ELEMENTS.filter(e => !before.has(e)), last: playersBefore(p).length === 0 }]
  }))
  const NO_ELEMS = new Set<string>()
  // Malamibe : elle tue le Féca à son 3e tour après l'invocation s'il ne l'a pas tuée (règle donnée par l'utilisateur le
  // 2026-10-17 ; vidéo : Tayro l'entame au 1er tour, la tue au 2e). `malaTour` : rang de ce tour depuis l'invocation ;
  // au 2e (ou invocation inconnue du journal), elle doit mourir.
  const malaHp = malamibe ? malamibe.hp : 0
  const malaTour = (() => {
    if (!malamibe || !st.malamibe || st.malamibe.id !== rOf(malamibe)) return 2
    const mi = st.order.indexOf(st.malamibe.id)
    // (invoquée après le tour du Féca dans sa manche, ou absente de la liste des tours : son 1er tour est à la suivante)
    const first = st.malamibe.summonRound + (mi < 0 || mi > myIdx ? 1 : 0)
    return st.round - first + 1
  })()
  const urgent = !!malamibe && malaTour >= 2
  const lastBeforeM = !!malamibe && playersBefore(malamibe).length === 0
  // (joueurs vivants de JOUEURS qui jouent après le Féca et avant la Malamibe : leur part, attendue ; une tueuse comptée
  // comme mule, toutes les mules mortes, frappe encore — playersBefore ne la voit pas)
  // (comptés dans l'état de chaque plan : une tueuse que le Féca tue ne frappera plus)
  const allieIds = (() => {
    const out: number[] = []
    if (!malamibe) return out
    for (const id of next) {
      if (id === rOf(malamibe)) break
      const f = st.res.fighters[id]
      if (f?.kind !== 'player' || !JOUEURS.includes(f.name) || !st.truth.alive.has(id)) continue
      const g = base.fighters.find(x => rOf(x) === id)
      if (g) out.push(g.id)
    }
    return out
  })()
  const allieAttendu = (s: FightState) => W.allieMalamibe * allieIds.filter(id => s.fighters[id]?.alive).length

  const baseHp = new Map(base.fighters.map(f => [f.id, f.alive ? f.hp : 0]))
  const baseAp = new Map(baseEnemies.map(f => [f.id, f.stats.ap]))
  const baseCell = new Map(base.fighters.map(f => [f.id, f.cell]))
  const baseCount = base.fighters.length

  // Coup d'arme (spellId 0, ARME, 2026-10-18) : au corps à corps, sur les mules et les tueuses tant qu'il y en a. Le moteur ne
  // le connaît pas : niveau construit sur celui de Bulle (même forme de données).
  const bulle = me0.spells.find(sp => sp.spellId === SORT.bulle)
  const cibleArme = new Set([...muleRids, ...[...tueuseIds].map(id => rOf(base.fighters[id])).filter((x): x is number => x !== undefined)])
  if (bulle && cibleArme.size && !me0.spells.some(sp => sp.spellId === 0)) {
    const eff0 = bulle.level.effects[0]
    const eff = { ...eff0, effectId: ARME.effet, diceNum: ARME.min, diceSide: ARME.max, element: ARME.element,
      // (sans baisse de dommages en zone : mule derrière la cible −699 ; g : alliés sauf le lanceur)
      zone: { ...eff0.zone, shape: ARME.zone, size: ARME.taille, minSize: 0, decreaseStepPct: 0 }, targetMask: 'g,A' }
    const level = {
      ...bulle.level, spellId: 0, apCost: ARME.pa, minRange: 1, range: 1, rangeBoostable: false, castInLine: false, castInDiagonal: false,
      maxCastPerTurn: ARME.parTour, maxCastPerTarget: 0, minCastInterval: 0, initialCooldown: 0, effects: [eff], criticalEffects: [eff],
    }
    me0.spells.push({ spellId: 0, level, isWeapon: true, name: "Coup d'arme" })
  }
  const usable = me0.spells.filter(sp => !ECARTES.has(sp.spellId))
  const buffs = usable.filter(sp => sp.level.range === 0 && !profiles.of(sp.level).damage.some(l => l.sides.enemy) && !profiles.of(sp.level).moves.length)
  const attacks = usable.filter(sp => !buffs.includes(sp))

  // Monstres qui peuvent toucher un personnage à leur prochain tour (zones de menaces depuis les cases du début du tour).
  const threatCache = new Map<string, ReturnType<typeof threatMap>>()
  function threatsFor(s: FightState): ReturnType<typeof threatMap> {
    const placed: Placed[] = enemies(s).filter(f => kindOf(f) && kindOf(f) !== MALAMIBE && active(f)).map(f => ({ monsterId: f.monsterId!, cell: f.cell }))
    const others = players(s).filter(f => f.id !== me0.id).map(f => f.cell)
    const key = placed.map(p => `${p.monsterId}@${p.cell}`).join(',') + '|' + others.join(',')
    let t = threatCache.get(key)
    if (!t) threatCache.set(key, (t = threatMap(s.map, placed, others)))
    return t
  }
  const reaches = new Set<number>()
  {
    const t = threatsFor(base)
    for (const c of players(base)) for (const src of t.sources.get(c.cell) ?? []) {
      const m = baseEnemies.find(f => f.cell === src)
      if (m) reaches.add(m.id)
    }
  }

  // ── Note des sorts lancés (sans la case de fin) ──
  function castTerms(s: FightState, elems: Map<number, Set<string>>): { score: number; guide: number; parts: Record<string, number>; mala: number; malaRaw: number } {
    let mala = 0
    let friendly = 0
    let pa = 0
    let muleKills = 0
    let muleDmg = 0
    let tueuse = 0
    for (const f of s.fighters) {
      const before = baseHp.get(f.id) ?? 0
      if (before <= 0) continue
      const lost = before - (f.alive ? f.hp : 0)
      if (tueuseIds.has(f.id)) {
        if (!f.alive) tueuse -= W.tueuseMort
        else if (lost > 0) tueuse += W.tueuse * Math.min(lost, Math.max(0, before - W.tueuseReste * f.maxHp))
        continue
      }
      if (muleIds.has(f.id)) {
        if (!f.alive) muleKills++
        else if (lost > 0) muleDmg += lost
        continue
      }
      if (f.team === me0.team) {
        if (f.kind === 'player' && lost > 0) friendly -= W.friendly * lost + (!f.alive ? 1e6 : 0)
        continue
      }
      const k = kindOf(f)
      if (k === MALAMIBE) mala += 0.5 * Math.max(0, lost)
      else if (k) {
        mala += Math.max(0, lost)
        // PA retirés : attaques en moins à son prochain tour.
        const fewer = attaquesDe(baseAp.get(f.id) ?? f.stats.ap) - attaquesDe(f.stats.ap)
        if (fewer > 0 && active(f)) pa += (W.pa * (DANGER_FECA[k] ?? 600) * powerFactor(f.stats.power) * fewer * (reaches.has(f.id) ? 1 : W.paFar)) / 3
      }
    }
    // (mules tuées : 2 000 PV de moins pour la Malamibe, comptés comme dommages sur elle ; pas dans `malaRaw`, qui estime
    // ce que le Féca pourra lui faire au tour suivant) Mules en vie et Malamibe pas à tuer ce tour : ses PV sont surtout
    // ceux des mules, frapper les Krobes ne sert presque à rien (`krobesAvecMules`, consigne du joueur, 2026-10-17 : « ça
    // ne sert à rien que Feca attaque Malamibe au 1er tour […] il vaut mieux attaquer les mules »).
    const eff = (mulesEnVie && !urgent ? W.krobesAvecMules : 1) * mala + (malamibe ? MALAMIBE_PAR_PERSO * muleKills : 0)
    let malaScore = 0
    const got = malamibe ? Math.min(eff, malaHp) : 0
    if (malamibe) {
      if (urgent) {
        const target = W.killMargin * malaHp
        malaScore = W.malamibe * W.urgent * Math.min(eff, target) + (eff >= target ? W.malamibeKill : 0)
        // Part du Féca : la Malamibe moins ce qu'en feront les joueurs qui jouent après lui (marge comprise), chaque PV
        // qui manque pénalisé, même quand il ne peut pas la tuer seul (2026-10-18 à 17:23 : sans ce gradient, la pénalité
        // `mustKill`, la même pour tous les plans, laissait choisir Bergerie au lieu d'une Bulle ; ratée de 87 PV).
        const allie = allieAttendu(s)
        const part = W.killMargin * Math.max(0, malaHp - allie)
        if (allie === 0 && lastBeforeM && eff < malaHp) malaScore -= W.mustKill
        if (eff < part) malaScore -= W.marginPenalty * (part - eff)
      } else malaScore = W.malamibeEarly * got
    }
    // (toujours : chaque Malamibe suivante aura aussi 2 000 PV de moins)
    const mules = W.mule * muleKills + W.muleDamage * muleDmg
    let elem = 0
    let elemGuide = 0
    for (const [id, info] of pataInfo) {
      if (!info.missing.length) continue
      const recv = elems.get(id) ?? NO_ELEMS
      const got = info.missing.filter(e => recv.has(e)).length
      if (!got) continue
      if (got === info.missing.length) elem += W.element * got + W.element
      else if (!info.last) elem += W.element * got
      else {
        elem -= W.elementWasted * got
        elemGuide += W.element * got + W.elementWasted * got
      }
    }
    let pes = 0
    if (tabacilles.length) {
      for (const v0 of virustines) {
        const v = s.fighters[v0.id]
        if (v.alive && v.states.includes(ETAT.pesanteur) && !base.fighters[v0.id].states.includes(ETAT.pesanteur)) pes += W.pesanteur
      }
    }
    const parts = { malamibe: Math.round(malaScore), pa: Math.round(pa), elements: elem, pesanteur: pes, friendly: Math.round(friendly), mules: Math.round(mules), tueuse: Math.round(tueuse) }
    const score = malaScore + pa + elem + pes + friendly + mules + tueuse
    return { score, guide: score + elemGuide, parts, mala: got, malaRaw: malamibe ? mala : 0 }
  }

  // ── Malamibe à son 1er tour : ce qu'il faut lui laisser au plus pour la finir au tour suivant ──
  /** Meilleurs dommages à la Malamibe vus pendant cette recherche (estimation de ce que le Féca pourra faire au 2e tour). */
  let bestMala = 0
  function deadlinePenalty(mala: number): number {
    // (mules en vie : ses PV tomberont avec elles, la pénalité n'a pas de sens — 2026-10-17 à 23:43, rejeu : −84 000)
    if (!malamibe || urgent || mulesEnVie) return 0
    const left = malaHp - Math.min(mala, malaHp)
    const cap = W.capSafety * bestMala
    return left > cap ? W.deadline * (left - cap) : 0
  }

  // ── Protections du Féca à la fin du tour : sorts lancés sur lui (glyphe-aura : il doit finir sur la case visée) ──
  function protectionsOf(steps: FStep[], end: number): Protection[] {
    const out: Protection[] = []
    let here = me0.cell
    for (const x of steps) {
      if (x.kind === 'move') {
        here = x.path[x.path.length - 1]
        continue
      }
      const p = PROTECTIONS[x.spell]
      if (!p) continue
      if (p.aura ? x.cell === end : x.cell === here) out.push(p)
    }
    return out
  }

  /**
   * Tabacille qui peut lancer Remontée gastrique sur le Féca en `end` à son tour : à pied, ou après un ou deux échanges
   * avec ses alliés (distances sans les obstacles ni la ligne de vue).
   */
  function strips(s: FightState, tab: Fighter, end: number): boolean {
    if (tab.stats.ap < PA_ATTAQUE) return false
    const hops = Math.min(ECHANGES_PAR_TOUR, Math.floor((tab.stats.ap - PA_ATTAQUE) / PA_ATTAQUE))
    const relays = enemies(s).filter(f => f.id !== tab.id).map(f => f.cell)
    let front = new Map([[tab.cell, Math.max(0, tab.stats.mp)]])
    for (let h = 0; ; h++) {
      for (const [cell, mp] of front) if (distance(cell, end) <= mp + PORTEE_REMONTEE) return true
      if (h >= hops) return false
      const out = new Map<number, number>()
      for (const [cell, mp] of front) for (const c of relays) {
        const left = mp - Math.max(0, distance(cell, c) - PORTEE_ECHANGE)
        if (left >= 0 && left > (out.get(c) ?? -1)) out.set(c, left)
      }
      front = out
    }
  }
  /**
   * Retraits que subira le Féca en `end`, dans l'ordre des tours à venir (chacun ôte un tour à ses effets) : Bacterrib
   * dont il est à 6 cases ou plus (au début de son tour), Tabacille qui l'atteint de sa Remontée gastrique.
   */
  function stripOf(s: FightState, end: number): Fighter[] {
    const out: Fighter[] = []
    for (const b of bacterribs) if (s.fighters[b.id].alive && distance(end, s.fighters[b.id].cell) >= 6) out.push(b)
    for (const t of tabacilles) if (active(t) && s.fighters[t.id].alive && strips(s, s.fighters[t.id], end)) out.push(t)
    return out.sort((a, b) => rank(a) - rank(b))
  }
  /** Rang du monstre qui retire la protection (son retrait numéro `tours`) ; elle protège de ceux qui jouent avant. */
  const cutOf = (p: Protection, cuts: Fighter[]) => (Number.isFinite(p.tours) && cuts[p.tours - 1] ? rank(cuts[p.tours - 1]) : Infinity)
  /**
   * Multiplicateur des dommages d'un monstre sur le Féca, selon ses protections et leurs retraits (stripOf). Ataraxie :
   * la première attaque du premier des `attackers` à jouer, sur ses attaques du tour (attaquesDe).
   */
  function protFactor(prot: Protection[], cuts: Fighter[], attackers: Fighter[]): (m: Fighter) => number {
    if (!prot.length) return () => 1
    const first = Math.min(...attackers.map(rank))
    return (m: Fighter) => {
      const melee = MELEE[kindOf(m)] ?? 0.5
      let f = 1
      for (const p of prot) {
        if (rank(m) >= cutOf(p, cuts)) continue
        if (p.premiere !== undefined) {
          if (rank(m) === first) f *= 1 - (1 - p.premiere) / Math.max(1, attaquesDe(m.stats.ap))
        } else f *= melee * p.melee + (1 - melee) * p.distance
      }
      return f
    }
  }
  /** Dommage brut attendu d'un monstre sur le Féca (part du Féca parmi les personnages qu'il peut toucher). */
  function rawThreat(m: Fighter, t: ReturnType<typeof threatMap>, others: number[]): number {
    const k = kindOf(m)
    const targets = 1 + others.filter(c => [...(t.sources.get(c) ?? [])].includes(m.cell)).length
    return (DANGER_FECA[k] ?? 600) * powerFactor(m.stats.power) * (k === VERMINOCULE ? 1 : Math.max(0.5, 1 / targets))
  }
  /**
   * Guide de la recherche : dommages que ses protections éviteraient s'il finissait sur sa case actuelle (sinon une
   * protection, qui ne rapporte qu'à la case de fin, est chassée du faisceau par les sorts de dommages).
   */
  function protGuide(s: FightState, steps: FStep[]): number {
    const here = s.fighters[me0.id].cell
    const prot = protectionsOf(steps, here)
    if (!prot.length) return 0
    const t = threatsFor(s)
    const others = players(s).filter(c => c.id !== me0.id).map(c => c.cell)
    const mons = enemies(s)
    const attackers = [...(t.sources.get(here) ?? [])].map(cell => mons.find(f => f.cell === cell)).filter((m): m is Fighter => !!m)
    const factor = protFactor(prot, stripOf(s, here), attackers)
    let saved = 0
    for (const m of attackers) saved += rawThreat(m, t, others) * (1 - factor(m))
    return W.threat * saved
  }

  // ── Coup d'après (phase de fuite) : les monstres qui chargent (Verminocule, Pataugerme, Virustine, Tabacille) marchent
  // vers la case de fin du Féca à leur tour ; au tour suivant, peut-il encore se mettre hors de leur portée, à pied ou par
  // Transhumance ? Sinon, les dommages qu'il ne pourra pas éviter comptent (2026-10-17, salle annexe : fin de manche 4
  // à 2 cases du Pataugerme et des deux Verminocules, encerclé en manche 5, −2 024 PV). Distances sans les obstacles. ──
  const reachCache = new Map<string, number[]>()
  function reachOf(s: FightState, m: Fighter): number[] {
    const key = `${m.id}@${m.cell}`
    let r = reachCache.get(key)
    if (!r) reachCache.set(key, (r = [...reachableCells(s, m, engine, Math.max(0, m.stats.mp)).cost.keys()]))
    return r
  }
  const transhumance = me0.spells.find(sp => TELEPORTS.has(sp.spellId))
  /** Dommages inévitables au tour suivant (meilleur repli du Féca) et leur part portée au contact. */
  function nextTurn(s: FightState, end: number, steps: FStep[]): { least: number; melee: number } {
    if (!fuite) return { least: 0, melee: 0 }
    const chasers = enemies(s).filter(m => active(m) && kindOf(m) !== BACTERRIB && PORTEE_ATTAQUE[kindOf(m)] !== undefined)
    if (!chasers.length) return { least: 0, melee: 0 }
    const proj = chasers.map(m => {
      let cell = m.cell
      for (const c of reachOf(s, m)) if (distance(c, end) < distance(cell, end)) cell = c
      const dmg = (DANGER_FECA[kindOf(m)] ?? 600) * powerFactor(m.stats.power)
      return { cell, reach: Math.max(0, m.stats.mp) + PORTEE_ATTAQUE[kindOf(m)], dmg, melee: dmg * (MELEE[kindOf(m)] ?? 0.5) }
    })
    const taken = new Set([...s.fighters.filter(f => f.alive && f.id !== me0.id && f.cell >= 0).map(f => f.cell), ...proj.map(p => p.cell)])
    const options = new Set([end])
    let ring = [end]
    for (let d = 0; d < me0.stats.mp; d++) {
      const out: number[] = []
      for (const c of ring) for (const n of neighborsOf(c)) {
        if (n < 0 || options.has(n) || taken.has(n) || !s.map.cells[n]?.walkable) continue
        options.add(n)
        out.push(n)
      }
      ring = out
    }
    const tp = transhumance && !steps.some(x => x.kind === 'cast' && x.spell === transhumance.spellId) && (me0.cooldowns[transhumance.spellId] ?? 0) <= 1
    if (tp) for (const c of s.map.cells) if (c.walkable && !taken.has(c.id) && distance(end, c.id) <= 6) options.add(c.id)
    let least = Infinity
    let melee = 0
    for (const c of options) {
      let sum = 0
      let near = 0
      for (const p of proj) if (distance(p.cell, c) <= p.reach) {
        sum += p.dmg
        near += p.melee
      }
      if (sum < least) {
        least = sum
        melee = sum > 0 ? near / sum : 0
      }
      if (least === 0) break
    }
    return { least, melee }
  }
  /**
   * Case où l'Échange subtil d'une Tabacille envoie le Féca en `c` (la case d'où elle le lance), sinon undefined : en
   * ligne, à 1-4 cases de lui, depuis une case qu'elle atteint à pied ou après un échange avec un de ses alliés (le second
   * Échange subtil du tour est celui qui prend le Féca). La plus proche de sa case de départ. Journaux du 2026-10-17 :
   * 27 échanges du Féca sur 156 tours de Tabacille sans Pesanteur, aucun sur 11 sous Ataraxie ; au combat perdu de
   * 17:43, deux échanges dès la manche 1 l'ont ramené au milieu des monstres (−839 PV, puis −2 723 en manche 2).
   */
  function swapCell(s: FightState, tab: Fighter, c: number): number | undefined {
    if (tab.stats.ap < PA_ATTAQUE) return undefined
    const walk = [tab.cell, ...reachOf(s, tab)]
    const from = new Set(walk)
    if (ECHANGES_PAR_TOUR > 1 && tab.stats.ap >= 2 * PA_ATTAQUE) {
      for (const a of enemies(s)) {
        if (a.id !== tab.id && walk.some(p => inLine(p, a.cell) && distance(p, a.cell) <= PORTEE_ECHANGE)) from.add(a.cell)
      }
    }
    let best: number | undefined
    for (const p of from) {
      const d = distance(p, c)
      if (d < 1 || d > PORTEE_ECHANGE || !inLine(p, c)) continue
      if (best === undefined || distance(p, tab.cell) < distance(best, tab.cell)) best = p
    }
    return best
  }
  /**
   * Case où le Gonflement d'un Verminocule amène le Féca en `c` : au contact du Verminocule, qui s'approche d'abord s'il
   * est à plus de sa portée (étoile de 3).
   */
  function pullCell(s: FightState, v: Fighter, c: number): number {
    let from = v.cell
    if (distance(from, c) > PORTEE_ATTAQUE[VERMINOCULE]) for (const r of reachOf(s, v)) if (distance(r, c) < distance(from, c)) from = r
    if (distance(from, c) <= 1) return c
    const taken = new Set(s.fighters.filter(f => f.alive && f.cell >= 0 && f.id !== me0.id).map(f => f.cell))
    let best = c
    for (const n of neighborsOf(from)) {
      if (n < 0 || taken.has(n) || !s.map.cells[n]?.walkable) continue
      if (best === c || distance(n, c) < distance(best, c)) best = n
    }
    return best
  }
  /** Relance d'un sort du Féca (tours). */
  const cooldownOf = (spellId: number) => me0.spells.find(sp => sp.spellId === spellId)?.level.minCastInterval ?? 0

  // ── Glyphes de fin de tour du Féca (Défiance : Terre, Feu, Eau et Air) : les Krobes qui finissent leur tour dedans
  // sont frappés, et leurs dommages vont à la Malamibe (celle du moment, ou la suivante, invoquée au début du tour d'un
  // Krobe). Krobes attendus dedans : le Verminocule déjà au contact du Féca (il y reste pour frapper), la Virustine qui
  // peut venir au contact (Contamination). ──
  const glyphCache = new Map<string, number>()
  /** Dommages du glyphe sur ce Krobe s'il finit son tour dedans (simulés une fois par glyphe). */
  function glyphHit(s: FightState, g: FightState['glyphs'][number], m: Fighter): number {
    const key = `${g.uid}@${g.center}:${m.id}`
    let d = glyphCache.get(key)
    if (d === undefined) {
      const sim = engine.cloneFight(s)
      const f = sim.fighters[m.id]
      const before = f.hp
      f.cell = g.cells.find(c => c !== s.fighters[me0.id].cell) ?? g.center
      marksTurnEnd(engine, sim, f)
      glyphCache.set(key, (d = Math.max(0, before - (f.alive ? f.hp : 0))))
    }
    return d
  }
  function glyphDamage(s: FightState, end: number, sources: Iterable<number>): number {
    const gs = s.glyphs.filter(g => g.trigger === 'turnEnd' && g.sourceId === me0.id)
    if (!gs.length) return 0
    const src = new Set(sources)
    const taken = new Set(s.fighters.filter(f => f.alive && f.cell >= 0).map(f => f.cell))
    let dmg = 0
    for (const m of enemies(s)) {
      const k = kindOf(m)
      if (!active(m) || !src.has(m.cell)) continue
      let cell = -1
      if (distance(m.cell, end) === 1 && (k === VERMINOCULE || k === VIRUSTINE)) cell = m.cell
      else if (k === VIRUSTINE && distance(m.cell, end) - 1 <= Math.max(0, m.stats.mp)) {
        for (const n of neighborsOf(end)) {
          if (n < 0 || taken.has(n) || !s.map.cells[n]?.walkable) continue
          if (cell < 0 || distance(n, m.cell) < distance(cell, m.cell)) cell = n
        }
        if (cell >= 0) taken.add(cell)
      }
      const g = cell >= 0 ? gs.find(x => x.cells.includes(cell)) : undefined
      if (g) dmg += glyphHit(s, g, m)
    }
    return dmg
  }

  // ── Note de la case de fin (positions de tous après le tour) ──
  function endTerms(s: FightState, end: number, steps: FStep[], elems: Map<number, Set<string>>, mala = 0): { score: number; parts: Record<string, number>; notes: string[]; glyphMala: number } {
    const notes: string[] = []
    const t = threatsFor(s)
    const mons = enemies(s)
    let contact = 0
    const tankOf = new Set<number>()
    const others = players(s).filter(c => c.id !== me0.id)
    // (phase de fuite : le Verminocule est laissé de côté)
    for (const vf of fuite ? [] : verminocules) {
      const v = s.fighters[vf.id]
      if (!v.alive) continue
      const stays = others.filter(c => distance(c.cell, v.cell) === 1 && !playsBefore(rOf(c), v))
      const tank = distance(end, v.cell) === 1
      if (tank) tankOf.add(v.id)
      if (!stays.length) {
        const helpers = playersBefore(v).filter(r => r !== myRid).filter(r => {
          const c = s.fighters[mo.eid.get(r) ?? -1]
          return c?.alive && distance(c.cell, v.cell) - 1 <= Math.max(0, c.stats.mp)
        })
        if (tank) contact += W.tankBonus
        else if (!helpers.length) {
          contact -= W.contact
          notes.push('Verminocule sans personne au contact')
        }
        if (guarding.has(v.id) && !tank) {
          contact -= W.approach * Math.max(0, distance(end, v.cell) - 1)
          if ([...(t.sources.get(end) ?? [])].includes(v.cell)) {
            contact -= W.exposed
            notes.push('à portée du Verminocule sans être à son contact')
          }
        }
      }
      const vStart = baseCell.get(v.id) ?? v.cell
      const held = players(base).some(c => c.id !== me0.id && distance(c.cell, vStart) === 1)
      if (held && !tank && !others.some(c => distance(c.cell, v.cell) === 1)) {
        contact -= W.contactBroken
        notes.push('contact du Verminocule cassé')
      }
    }
    const prot = protectionsOf(steps, end)
    const cuts = stripOf(s, end)
    // Coups attendus, dans l'ordre des tours : le Gonflement d'un Verminocule attire le Féca à son contact, et les
    // monstres suivants frappent depuis cette case (2026-10-17, 13:42 : fin en 489 à portée d'un seul Verminocule, attiré
    // en 460 à portée des deux autres et d'une Virustine, −1 678 PV).
    // (Inébranlable, par Bergerie : pas d'attirance.) Lanternes du Berger : chacune leurre le premier Krobe qui peut la
    // frapper et n'en est pas plus loin que du Féca ; il garde peu de coups pour lui, et ne l'attire pas.
    // Échange subtil des Tabacilles (sauf sous Pesanteur : Ataraxie, Bergerie) : le Féca est envoyé sur la case d'où elle
    // le lance, et les monstres suivants frappent de là.
    const hits: { m: Fighter; raw: number }[] = []
    const anchored = s.fighters[me0.id].states.includes(INEBRANLABLE)
    const heavy = s.fighters[me0.id].states.includes(ETAT.pesanteur)
    const lanternes = s.fighters.filter(f => f.alive && f.team === me0.team && f.monsterId === LANTERNE && f.cell >= 0).map(f => f.cell)
    const leurres: string[] = []
    const swaps: number[] = []
    let at = end
    let held = false
    let blocked = false
    for (const m of mons.filter(f => kindOf(f) && kindOf(f) !== MALAMIBE).sort((a, b) => rank(a) - rank(b))) {
      if (kindOf(m) === TABACILLE && active(m) && !lanternes.some(c => t.sources.get(c)?.has(m.cell) && distance(m.cell, c) <= distance(m.cell, at))) {
        const to = swapCell(s, m, at)
        if (to !== undefined && heavy) blocked = true
        else if (to !== undefined) {
          swaps.push(to)
          at = to
          hits.push({ m, raw: rawThreat(m, t, others.map(c => c.cell)) })
          continue
        }
      }
      if (!t.sources.get(at)?.has(m.cell)) continue
      const lure = lanternes.findIndex(c => t.sources.get(c)?.has(m.cell) && distance(m.cell, c) <= distance(m.cell, at))
      if (lure >= 0) {
        lanternes.splice(lure, 1)
        leurres.push(m.name)
        hits.push({ m, raw: LEURRE * rawThreat(m, t, others.map(c => c.cell)) })
        continue
      }
      if (kindOf(m) === VERMINOCULE && distance(m.cell, at) > 1) {
        if (anchored) held = true
        else at = pullCell(s, m, at)
      }
      let raw = rawThreat(m, t, others.map(c => c.cell))
      // Pataugerme : une ligne de Brûlure de plus par élément reçu depuis son dernier tour (avant ce tour et pendant).
      const info = pataInfo.get(m.id)
      if (info) {
        const lines = new Set([...info.before, ...(elems.get(m.id) ?? NO_ELEMS)]).size
        raw += BRULURE_PAR_ELEMENT * lines * powerFactor(m.stats.power)
      }
      hits.push({ m, raw })
    }
    if (swaps.length) notes.push(`échangé par ${swaps.length > 1 ? `${swaps.length} Tabacilles` : 'une Tabacille'} (en ${swaps.join(' puis ')})`)
    if (blocked) notes.push('sous Pesanteur : pas d’échange des Tabacilles')
    if (at !== end && at !== swaps.at(-1)) notes.push(`attiré en ${at} par le Gonflement d'un Verminocule`)
    if (held) notes.push('Inébranlable (Bergerie) : pas attiré par le Gonflement')
    if (leurres.length) notes.push(`Lanterne du Berger : leurre pour ${leurres.join(', ')}`)
    const factor = protFactor(prot, cuts, hits.map(h => h.m))
    let threat = 0
    let expected = 0
    let saved = 0
    for (const { m, raw } of hits) {
      const dmg = raw * factor(m)
      saved += raw - dmg
      expected += dmg
      threat -= W.threat * dmg
    }
    const me = s.fighters[me0.id]
    const myHp = Math.min(me.hp, baseHp.get(me0.id) ?? me.hp)
    const frail = 1 + 2 * Math.max(0, 1 - myHp / Math.max(1, me.maxHp))
    threat *= frail
    if (expected >= myHp) {
      threat -= W.death
      notes.push(`mort possible (≈ ${Math.round(expected)} dommages attendus pour ${myHp} PV)`)
    }
    if (saved > 0) notes.push(`protections : ≈ ${Math.round(saved)} dommages évités (${prot.map(p => p.nom).join(', ')})`)
    // Protections retirées avant qu'un des monstres qui le menacent ne frappe, et par qui.
    const lost = new Map<Fighter, string[]>()
    for (const p of prot) {
      const at = cutOf(p, cuts)
      if (at === Infinity || !hits.some(h => rank(h.m) >= at)) continue
      const by = cuts[p.tours - 1]
      lost.set(by, [...(lost.get(by) ?? []), p.nom])
    }
    for (const [by, noms] of lost) {
      notes.push(`${noms.join(', ')} retirée(s) par ${kindOf(by) === TABACILLE ? 'la Tabacille (Remontée gastrique)' : 'la Bacterrib (à 6 cases ou plus)'}`)
    }
    let bact = 0
    for (const b0 of bacterribs) {
      const b = s.fighters[b0.id]
      if (!b.alive) continue
      if (distance(end, b.cell) <= 5) {
        bact -= W.bacterrib
        notes.push(`à ${distance(end, b.cell)} case(s) d'une Bacterrib`)
      }
      if (s.fighters.some(f => f.alive && muleIds.has(f.id) && distance(f.cell, b.cell) <= 5)) {
        bact -= W.muleBacterrib
        notes.push('mule à 5 cases ou moins d’une Bacterrib (relancée si elle vit encore à son tour)')
      }
    }
    let tackle = 0
    for (const m of mons) if (distance(m.cell, end) === 1 && !tankOf.has(m.id) && kindOf(m) !== MALAMIBE && active(m)) tackle -= W.tackle
    const next = nextTurn(s, end, steps)
    const trap = -W.trap * next.least
    if (next.least > 0) notes.push(`tour suivant : ≈ ${Math.round(next.least)} dommages inévitables (pas de repli hors d'atteinte)`)
    // Protections à longue relance lancées ce tour : ce qu'elles auraient évité au tour suivant, s'il est plus dangereux.
    // (Elles ne protègent ce tour-ci que des monstres qui jouent avant leur retrait.)
    let reserve = 0
    if (next.least > 0) {
      for (const x of steps) {
        if (x.kind !== 'cast' || !PROTECTIONS[x.spell] || cooldownOf(x.spell) < 2) continue
        const p = PROTECTIONS[x.spell]
        let now = 0
        for (const { m, raw } of hits) {
          if (rank(m) >= cutOf(p, cuts)) continue
          const melee = MELEE[kindOf(m)] ?? 0.5
          now += raw * (1 - (melee * p.melee + (1 - melee) * p.distance))
        }
        const later = next.least * (1 - (next.melee * p.melee + (1 - next.melee) * p.distance))
        if (later > now) {
          reserve -= W.reserve * (later - now)
          notes.push(`${p.nom} plus utile au tour suivant (≈ ${Math.round(later)} contre ${Math.round(now)})`)
        }
      }
    }
    // (échanges des Tabacilles : dans les coups attendus, plus haut)
    const swap = 0
    // Glyphe de Défiance : dommages à la Malamibe pendant le tour des Krobes (celle-ci si elle n'est pas à tuer ce tour,
    // sinon la suivante).
    let glyphMala = 0
    if (baseEnemies.some(f => active(f) && isKrobe(f.monsterId))) {
      const room = malamibe && !urgent ? Math.max(0, malaHp - mala) : MALAMIBE_PV
      glyphMala = Math.min(room, glyphDamage(s, end, t.sources.get(end) ?? []))
    }
    const glyphe = W.malamibeEarly * glyphMala
    if (glyphMala > 0) notes.push(`glyphe de Défiance : ≈ ${Math.round(glyphMala)} dommages pour la Malamibe (Krobes à son contact)`)
    const parts = { threat: Math.round(threat), trap: Math.round(trap), reserve: Math.round(reserve), bacterrib: bact, contact, tackle, swap, glyphe: Math.round(glyphe) }
    return { score: threat + trap + reserve + bact + contact + tackle + swap + glyphe, parts, notes, glyphMala }
  }

  // ── Règles des Krobes sur un lancer (après simulation) ──
  function forbidden(before: FightState, after: FightState, sp: KnownSpell, cell: number, from: number): string | null {
    for (const virustine of virustines) {
      const v0 = before.fighters[virustine.id]
      const v1 = after.fighters[virustine.id]
      if (v0.alive && v1.alive && v0.cell !== v1.cell) return 'déplace la Virustine'
      for (let k = from; k < after.events.length; k++) {
        const e = after.events[k]
        if (e.t === 'apmp' && e.target === virustine.id && e.mp < 0) return 'retire des PM à la Virustine'
      }
      const p = profiles.of(sp.level)
      const at = before.fighters[me0.id].cell
      for (const l of p.removals) {
        if (l.pool !== 'mp' || !l.sides.enemy) continue
        if (zoneCells(l.zone, cell, at).includes(v0.cell)) return 'vise les PM de la Virustine'
      }
    }
    if (tabacilles.length) {
      for (const f of after.fighters) {
        if (f.team !== me0.team || f.kind !== 'player') continue
        if (f.hp > before.fighters[f.id].hp) return 'soigne un personnage (Tabacille)'
      }
    }
    if (bacterribs.length) {
      for (const f of after.fighters.slice(Math.max(baseCount, before.fighters.length))) {
        if (!f.alive || f.team !== me0.team) continue
        for (const b of bacterribs) {
          const bc = after.fighters[b.id]
          if (bc.alive && distance(f.cell, bc.cell) <= 5) return 'invocation à 5 cases ou moins d’une Bacterrib'
        }
      }
    }
    return null
  }

  const sigOf = (s: FightState, steps: FStep[]) => {
    const m = s.fighters[me0.id]
    const casts = steps.filter(x => x.kind === 'cast').map(x => `${(x as { spell: number }).spell}@${(x as { cell: number }).cell}`).sort().join(',')
    const pos = s.fighters.filter(f => f.alive && f.id !== me0.id).map(f => `${f.cell}:${Math.round(f.hp)}:${Math.round(f.stats.ap)}`).join(',')
    return `${m.cell}|${m.ap}|${m.mp}|${casts}|${pos}`
  }

  /**
   * Guide de la recherche (phase de tank) : le contact de chaque Verminocule encore atteignable avec les PM qui restent
   * (2026-10-17 : Transhumance au contact chassée du faisceau, qui ne compte le contact qu'à la case de fin ; Giboulée,
   * qui repousse le Verminocule de 4 cases, gardée à sa place).
   */
  function contactGuide(s: FightState): number {
    if (fuite) return 0
    const m = s.fighters[me0.id]
    let g = 0
    for (const v0 of verminocules) {
      if (!guarding.has(v0.id)) continue
      const v = s.fighters[v0.id]
      if (!v.alive) continue
      const gap = distance(m.cell, v.cell) - 1 - Math.max(0, m.mp)
      g += gap <= 0 ? W.contact : -W.approach * gap
    }
    return g
  }

  function node(s: FightState, steps: FStep[], elems: Map<number, Set<string>>, notes: string[]): Node {
    const c = castTerms(s, elems)
    // (dommages possibles par tour : sans le plafond des PV de la Malamibe actuelle)
    if (c.malaRaw > bestMala) bestMala = c.malaRaw
    return {
      fight: s, steps, score: c.score, guide: c.guide + protGuide(s, steps) + contactGuide(s) - deadlinePenalty(c.mala), mala: c.mala, malaRaw: c.malaRaw, parts: c.parts,
      elems, notes, sig: sigOf(s, steps),
    }
  }

  function cast(n: Node, sp: KnownSpell, cell: number): Node | null {
    const m = n.fight.fighters[me0.id]
    // (« sort@*@* » : refusé pour un état, écarté pour tout le tour)
    if (opts.forbid?.has(`${sp.spellId}@${cell}@${m.cell}`) || opts.forbid?.has(`${sp.spellId}@${cell}@*`) || opts.forbid?.has(`${sp.spellId}@*@*`)) return null
    if (canCast(engine, n.fight, m, sp, cell) !== null) return null
    const s = engine.cloneFightForSim(n.fight, true)
    const target = s.fighters.find(f => f.alive && f.cell === cell)
    const from = s.events.length
    evaluated++
    if (!castSpell(engine, s, s.fighters[me0.id], sp.spellId, cell).ok || !s.fighters[me0.id].alive) return null
    if (s.fighters[me0.id].mp > m.mp) s.fighters[me0.id].mp = m.mp
    applyCastRules(engine, s, s.fighters[me0.id], sp.spellId)
    if (forbidden(n.fight, s, sp, cell, from)) return null
    // Dommages aux mules et aux tueuses : seule Bulle compte. Les autres sorts du Féca touchent à peine les alliés en jeu
    // (2026-10-18 : Silbo 14 à 33 par mule, Giboulée 59 à 132 ; le moteur en prévoyait 3 à 6 fois plus, deux Silbo lancés
    // pour rien au 1er tour, Malamibe ratée d'environ 170 PV).
    // (PV rendus aux vivantes ; une mule tuée par le moteur n'est plus sur la carte : lancer écarté, sa mort ne serait pas
    // réelle — 2026-10-18, Langueur prévue pour achever deux mules après Bulle ; coup d'arme : compté)
    if (sp.spellId !== SORT.bulle && sp.spellId !== 0) {
      for (const id of [...muleIds, ...tueuseIds]) {
        const was = n.fight.fighters[id]
        const f = s.fighters[id]
        if (!f || !was || !was.alive) continue
        if (!f.alive) return null
        f.hp = was.hp
      }
    }
    let elems = n.elems
    for (let k = from; k < s.events.length; k++) {
      const e = s.events[k]
      if (e.t !== 'damage' || !pataInfo.has(e.target)) continue
      const name = ELEMENTS[e.element as number]
      const had = elems.get(e.target) ?? NO_ELEMS
      if (name && !had.has(name)) elems = new Map([...elems, [e.target, new Set([...had, name])]])
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

  /**
   * Arrivées d'une téléportation : les cases libres à portée que le moins de monstres peuvent toucher, puis les plus loin
   * d'eux (2026-10-17, salle annexe : Transhumance n'était cherchée que loin des Bacterribs, jamais pour fuir les autres).
   */
  function escapes(s: FightState, from: number, max: number): number[] {
    const mons = enemies(s).filter(m => active(m) && kindOf(m) !== 0 && kindOf(m) !== MALAMIBE)
    if (!mons.length) return []
    const t = threatsFor(s)
    const taken = new Set(s.fighters.filter(f => f.alive).map(f => f.cell))
    return s.map.cells
      .filter(c => c.walkable && !taken.has(c.id) && distance(from, c.id) <= max)
      .map(c => ({ id: c.id, n: t.sources.get(c.id)?.size ?? 0, d: Math.min(...mons.map(m => distance(c.id, m.cell))) }))
      .sort((a, b) => a.n - b.n || b.d - a.d)
      .slice(0, 6)
      .map(x => x.id)
  }

  /** Cases cibles d'un sort : ennemis (et leurs voisines pour les zones) ; soi pour les sorts de portée 0 ou qui le permettent. */
  function targetsFor(s: FightState, sp: KnownSpell, from: number): number[] {
    if (sp.level.range === 0) return [from]
    // (coup d'arme : sur les mules et les tueuses seulement)
    if (sp.spellId === 0) return s.fighters.filter(f => f.alive && f.cell >= 0 && (muleIds.has(f.id) || tueuseIds.has(f.id))).map(f => f.cell)
    const p = profiles.of(sp.level)
    const cells = new Set<number>()
    if (sp.level.minRange === 0) cells.add(from)
    // (et les mules, à tuer)
    for (const e of [...enemies(s), ...s.fighters.filter(f => f.alive && f.cell >= 0 && (muleIds.has(f.id) || tueuseIds.has(f.id)))]) {
      cells.add(e.cell)
      if (p.zoneRadius > 0 || p.needFreeCell) for (const c of neighborsOf(e.cell)) cells.add(c)
    }
    const max = sp.level.range + (sp.level.rangeBoostable ? Math.max(0, s.fighters[me0.id].stats.range) : 0)
    if (TELEPORTS.has(sp.spellId)) for (const c of escapes(s, from, max)) cells.add(c)
    return [...cells].filter(c => c >= 0 && distance(from, c) <= max + 12)
  }

  // ── 1. Départs : sorts de soutien (tous les sous-ensembles) ──
  let roots: Node[] = [node(base, [], new Map(), [])]
  for (const bf of buffs) {
    const more: Node[] = []
    for (const r of roots) {
      const x = cast(r, bf, r.fight.fighters[me0.id].cell)
      if (x) more.push(x)
    }
    roots = roots.concat(more)
  }

  // ── 2. Cases de tir, classées par le meilleur lancer qu'elles permettent ──
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
  const reach0 = reachableCells(base, me0, engine, me0.mp)
  const scored: { cell: number; v: number }[] = []
  for (const [cell, cost] of reach0.cost) scored.push({ cell, v: bestFrom(roots[0], cell) - cost })
  scored.sort((a, b) => b.v - a.v)
  const keep = scored.slice(0, keepCells).map(x => x.cell)
  if (!keep.includes(me0.cell)) keep.push(me0.cell)
  const part = opts.partition && opts.partition.count > 1 ? opts.partition : undefined
  const kept = part ? keep.filter((_, i) => i % part.count === part.index) : keep
  const frontier: Node[] = []
  for (const r of roots) for (const c of kept) {
    const x = c === r.fight.fighters[me0.id].cell ? r : walk(r, c)
    if (x) frontier.push(x)
  }

  // ── 3. Faisceau de lancers ──
  // (protections et Bergerie — Inébranlable, pas d'attirance par le Gonflement ; Pesanteur, pas d'échange — ne valent
  // qu'à la case de fin : les meilleurs nœuds qui en lancent sont gardés à chaque niveau, sinon les sorts de dommages les
  // chassent ; 2026-10-17, 13:42 : Bergerie jamais essayée, Féca attiré au milieu de trois Verminocules)
  // (et la Lanterne du Berger, leurre : elle aussi ne vaut qu'à la case de fin)
  const lures = (n: Node) => n.fight.fighters.some(f => f.alive && f.team === me0.team && f.monsterId === LANTERNE)
  const protects = (n: Node) => lures(n) || n.steps.some(x => x.kind === 'cast' && (PROTECTIONS[x.spell] || x.spell === SORT.bergerie))
  const anchors = (n: Node) => n.steps.some(x => x.kind === 'cast' && x.spell === SORT.bergerie)
  const beamWidth = opts.beam ?? 32
  const maxCasts = opts.maxCasts ?? 6
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
    const rest = nextNodes.slice(3 * beamWidth)
    pool.push(...nextNodes.slice(0, 3 * beamWidth), ...rest.filter(n => protects(n) && !anchors(n)).slice(0, beamWidth),
      ...rest.filter(anchors).slice(0, beamWidth / 2))
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
  // (les protections ne comptent qu'à la case de fin : les nœuds qui en lancent sont gardés en plus)
  const finishers = opts.finishers ?? 40
  const byScore = [...pool].sort((a, b) => b.score - a.score).slice(0, finishers)
  const byGuide = [...pool].sort((a, b) => b.guide - a.guide).filter(n => !byScore.includes(n)).slice(0, Math.ceil(finishers / 4))
  const withProt = [...pool].filter(n => protects(n) && !byScore.includes(n) && !byGuide.includes(n)).sort((a, b) => b.score - a.score).slice(0, Math.ceil(finishers / 2))
  // (un sort qui déplace le Féca, Transhumance ou Escapade, ne rapporte qu'à la case de fin : le meilleur nœud de chaque
  // case ainsi atteinte est gardé aussi — 2026-10-17, salle annexe encerclée : la Transhumance qui le dégageait était
  // chassée par les sorts qui donnent ses éléments au Pataugerme)
  const walkedTo = (n: Node) => {
    const mv = n.steps.filter(x => x.kind === 'move').at(-1)
    return mv?.kind === 'move' ? mv.path[mv.path.length - 1] : me0.cell
  }
  const byCell = new Map<number, Node>()
  for (const n of pool) {
    const c = n.fight.fighters[me0.id].cell
    if (c === walkedTo(n) || byScore.includes(n) || byGuide.includes(n) || withProt.includes(n)) continue
    if (!byCell.has(c) || byCell.get(c)!.score < n.score) byCell.set(c, n)
  }
  const moved = [...byCell.values()].sort((a, b) => b.score - a.score).slice(0, Math.ceil(finishers / 4))
  // (Bergerie : ses nœuds, sans valeur avant la case de fin, sont devancés par ceux des protections)
  const taken = new Set([...byScore, ...byGuide, ...withProt, ...moved])
  const anchoredNodes = pool.filter(n => !taken.has(n) && anchors(n))
    .sort((a, b) => b.score - a.score).slice(0, Math.ceil(finishers / 4))
  const plans: FecaPlan[] = []
  const done = new Set<string>()
  for (const n of [...byScore, ...byGuide, ...withProt, ...moved, ...anchoredNodes]) {
    const s = n.fight
    const m = s.fighters[me0.id]
    const r = reachableCells(s, m, engine, Math.max(0, m.mp))
    let best: { node: Node; end: ReturnType<typeof endTerms>; total: number } | null = null
    for (const cell of r.cost.keys()) {
      const w = cell === m.cell ? n : walk(n, cell)
      if (!w) continue
      const end = endTerms(w.fight, w.fight.fighters[me0.id].cell, w.steps, w.elems, w.mala)
      const total = w.score + end.score - deadlinePenalty(w.mala + end.glyphMala) - 0.5 * (w.steps.length - n.steps.length)
      if (!best || total > best.total) best = { node: w, end, total }
    }
    if (!best) continue
    const key = best.node.steps.map(x => (x.kind === 'move' ? `>${x.path.at(-1)}` : `${x.spell}@${x.cell}`)).join(' ')
    if (done.has(key)) continue
    done.add(key)
    plans.push({
      steps: best.node.steps, endCell: best.node.fight.fighters[me0.id].cell, score: Math.round(best.total),
      parts: { ...best.node.parts, ...best.end.parts },
      notes: [
        fuite ? 'phase de fuite' : 'phase de tank',
        ...(condamnes.size ? [`condamnés : ${[...condamnes].map(id => base.fighters[id].name).join(', ')}`] : []),
        ...(soigne && tabacilles.some(t => st.order.indexOf(rOf(t) ?? -1) > myIdx)
          ? ['« Le Singe et la Lune » : son soin (manches 3, 6, 9…) relance les Tabacilles qui jouent après le Féca, elles ne mourront pas'] : []),
        ...(malamibe ? [urgent
          ? `Malamibe à tuer ce tour (${Math.round(malaHp)} PV, ${Math.round(best.node.malaRaw)} dommages prévus, marge visée ${Math.round(W.killMargin * malaHp)})`
          : `Malamibe 1er tour : ${Math.round(best.node.mala)} dommages, ${Math.round(malaHp - best.node.mala)} PV laissés (≈ ${Math.round(bestMala)} possibles par tour)`] : []),
        ...best.node.notes, ...best.end.notes,
      ],
    })
  }
  plans.sort((a, b) => b.score - a.score)
  return { plans: plans.slice(0, 3), evaluated, ms: Date.now() - t0 }
}
