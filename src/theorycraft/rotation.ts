/**
 * Theorycraft contre un boss — DPT SOUTENU sur plusieurs tours (docs/design/theorycraft.md §1.5).
 *
 * Le sac à dos de DPT (`DptTableImpl.turn`, src/ai/core/dpt.ts) donne le meilleur tour ISOLÉ : sur un combattant neuf,
 * un sort à relance compte à chaque tour (Colère de Iop, relance 3, lancée « tous les tours »). `sustainedDamage` le
 * déroule tour par tour en tenant l'état des relances, comme le moteur :
 *  - début de tour (`Engine.startTurn`) : toutes les relances décomptées de 1, compteurs de lancers du tour remis à zéro ;
 *  - tour : sac à dos sur les PA en mode 'now' (`castsAvailable` : sort indisponible tant que sa relance est > 0,
 *    `castsPerTurn`/`castsPerTarget` du tour, critère d'états du lanceur) ;
 *  - après les lancers (`castSpell`, src/engine/cast.ts) : relance du sort = `minCastInterval` (après modificateurs de
 *    sort), relevée à `globalCooldown` (la relance globale s'applique aussi au lanceur).
 *
 * POISONS SUIVIS d'un tour à l'autre (table du theorycraft, `TheoryDptTable.split`, hits.ts) au lieu de l'heuristique du
 * sac à dos (poison × min(durée, 2) × 0,8 à CHAQUE lancer, sans cumul ni recouvrement : Flèche Tyrannique du Crâ, cumul
 * 1, lancée deux fois par tour, y vaut 3,2 échéances par tour au lieu d'une). Chaque poison a ses instances actives sur
 * la cible (échéances restantes ; une échéance par tour, sans critique comme dans le moteur ; durée bornée à
 * `SUSTAINED_TURNS`, comme la fiche du boss). Une application pose une instance de `durée` échéances ; au-delà du cumul
 * maximal du sort (`maxStack` du niveau qui porte l'effet, 1 s'il retire d'abord ses propres effets), la plus ancienne
 * est retirée avec ses échéances restantes. Un lancer vaut donc sa part immédiate (différés × 0,8 comme le sac à dos)
 * + les échéances qu'il AJOUTE (durée − échéances restantes de l'instance retirée) : le sac à dos de chaque tour choisit
 * sur ces valeurs (le n-ième lancer d'un même sort dans le tour voit les n − 1 premiers), et la suite des tours ne
 * dépend que des relances et des instances actives au début du tour. Crédit au lancer : sur une période du régime
 * établi, la somme des échéances ajoutées égale celle des échéances tombées. Sans poison, le tour est exactement celui
 * de `DptTableImpl.turn` (mêmes valeurs, même départage).
 *
 * Point de départ : début de combat SANS relance initiale ni poison actif (tous les sorts prêts au tour 1 ; option
 * `initialCooldowns` pour les relances initiales du moteur). Sortie (`SustainedDamage`, types.ts) :
 *  - `perTurn`, `casts`, `mean` : les `turns` premiers tours et leur moyenne. Cette moyenne dépend de l'horizon : un sort
 *    de relance c est lancé ceil(turns / c) fois (dès le tour 1) au lieu de turns / c en régime établi, ce qui la tire
 *    vers la rafale ;
 *  - `steady`, `period`, `steadyBySpell` : RÉGIME ÉTABLI (« relances amorties » du contrat), indépendant de l'horizon :
 *    la suite des tours devient périodique dès qu'un état (relances, poisons actifs) se répète ; `steady` est la moyenne
 *    d'une période, détaillée par sort. C'est la valeur à utiliser pour classer ;
 *  - `burst` : rafale (le premier tour d'un combattant neuf : relances et poisons ignorés).
 * Ni la moyenne ni le régime établi ne dépassent la rafale (chaque tour choisit parmi un sous-ensemble des sorts, avec
 * les mêmes PA, et un poison déjà actif n'ajoute pas plus d'échéances que sur une cible neuve).
 *
 * NON calibré : aucune `calibrationOf` (facteur figé par preset, mesuré au Vortex) — les classes se comparent sur
 * l'analytique brut.
 *
 * Limites (affichées par le theorycraft) :
 *  - glouton par tour : chaque tour maximise ses propres dégâts, sans garder un sort à relance pour un tour où il
 *    vaudrait plus (aucun intérêt tant que les dégâts d'un sort ne dépendent pas du tour) ;
 *  - ni rampes ni cumuls entre tours (effet 293 « dommages de base » : Fureur, Colère de Iop au retour de relance,
 *    paliers de Flèche Dévorante), ni buffs entre sorts (un sort sans ligne de dégâts n'est jamais lancé), ni PA rendus
 *    en cours de tour (Marée du Steamer) ;
 *  - ni invocations, glyphes, pièges, bombes, arme ; effets différés × 0,8 (heuristique du sac à dos, même retirés par
 *    une relance du sort) ; poisons portés par un sous-sort DÉCLENCHÉ (« lance un sort » au début ou à la fin du tour)
 *    non suivis ; aucune contrainte de position, de PM ni de ligne de vue ;
 *  - états du lanceur et de la cible FIGÉS (posture : stances.ts ; phase du boss : fighters.ts) ;
 *  - relances initiales (`initialCooldown`) ignorées par défaut (option `initialCooldowns`) : sans effet sur `steady`
 *    tant que le même cycle est atteint, elles ne changent que les premiers tours.
 *
 * Les combattants passés ne sont pas modifiés : la simulation travaille sur des copies superficielles (relances et
 * compteurs propres, caractéristiques et sorts partagés en lecture seule ; mêmes empreintes de cache DPT).
 * Déterministe (aucun aléa, ordre des sorts du combattant).
 */
import { castsAvailable, type DptTableImpl } from '../ai/core/dpt'
import type { SpellProfileX } from '../ai/core/spellProfile'
import type { Fighter } from '../engine/types'
import { SUSTAINED_TURNS } from './bossProfile'
import { assertDistinct } from './fighters'
import { TheoryDptTable, type CastSplit } from './hits'
import type { SustainedDamage } from './types'

export interface SustainedOptions {
  /** Tours simulés (défaut 6, au moins 1). */
  turns?: number
  /** PA par tour (défaut : PA du lanceur, `a.stats.ap`). */
  ap?: number
  /**
   * Relances initiales des sorts (`initialCooldown`, posées à l'entrée en combat par le moteur) : début de combat réel
   * plutôt que tous les sorts prêts au tour 1. Défaut faux.
   */
  initialCooldowns?: boolean
}

/**
 * Plafond de tours simulés pour trouver la période du régime établi (au-delà, `steady` est la moyenne des
 * `STEADY_FALLBACK` derniers tours et `period` vaut 0). Presets de base : période de 1 à 5 tours.
 */
const MAX_STEADY_TURNS = 240
const STEADY_FALLBACK = 120
/** PA au plus et lancers possibles au plus par tour (comme le sac à dos de l'IA). */
const MAX_AP = 24
const MAX_ITEMS = 96

/** Copie superficielle « au repos » : aucune relance, aucun lancer ce tour (l'original n'est pas touché). */
function restingCopy(f: Fighter): Fighter {
  return { ...f, cooldowns: {}, castsThisTurn: {}, castsOnTarget: {} }
}

/** Relances décomptées d'un tour (nouvel objet ; entrées à 0 retirées). */
function decremented(cds: Readonly<Record<number, number>>): Record<number, number> {
  const out: Record<number, number> = {}
  for (const k in cds) if (cds[k] > 1) out[k] = cds[k] - 1
  return out
}

/** Poisons actifs : par poison (index dans `PoisonBook.dots`), échéances restantes des instances, la plus ancienne d'abord. */
type Poisons = number[][]

/** Poisons des sorts du lanceur (une entrée par ligne de poison) et sorts qui les posent. */
interface PoisonBook {
  dots: { turns: number; stack: number; tick: number }[]
  /** Par sort (index de `a.spells`) : indices de ses poisons dans `dots`. */
  bySpell: Map<number, number[]>
}

/** Lancer d'un sort : décomposition et profil (coût, limites de lancers). */
type SpellSplit = CastSplit & { profile: SpellProfileX }

/** Échéances ajoutées par une application (instances `list` modifiées en place). */
function applyPoison(list: number[], turns: number, stack: number): number {
  list.push(turns)
  return list.length > stack ? turns - list.shift()! : turns
}

/** Clé d'un état (relances + poisons actifs) : une répétition ferme la période du régime établi. */
function stateKey(cds: Readonly<Record<number, number>>, poisons: Poisons): string {
  const c = Object.keys(cds)
    .map(Number)
    .sort((x, y) => x - y)
    .map(k => `${k}:${cds[k]}`)
    .join(',')
  return poisons.some(l => l.length) ? `${c}|${poisons.map(l => l.join('.')).join('/')}` : c
}

/** Un tour planifié : lancers (ids), valeur créditée (immédiat + échéances ajoutées), répartition par sort, état suivant. */
interface PlannedTurn {
  casts: number[]
  value: number
  bySpell: Map<number, number>
  /** Poisons après les lancers du tour. */
  after: Poisons
}

/**
 * Sac à dos d'un tour (mêmes règles et même départage que `DptTableImpl.turn`), chaque lancer valant sa part immédiate
 * plus les échéances de poison qu'il ajoute aux instances `poisons` (le n-ième lancer d'un sort voit les précédents).
 * `poisons` n'est pas modifié.
 */
function planTurn(a: Fighter, d: Fighter, ap: number, splits: readonly (SpellSplit | undefined)[], book: PoisonBook, poisons: Poisons): PlannedTurn {
  const apInt = Math.max(0, Math.min(MAX_AP, Math.floor(ap + 1e-9)))
  const dpMean = new Float64Array(apInt + 1)
  const items: { spell: number; cost: number; value: number }[] = []
  const takes: Uint8Array[] = []
  const free: { spell: number; value: number }[] = []
  /** Valeurs successives des lancers d'un sort (sur une copie des poisons). */
  const copies = (i: number, sp: SpellSplit, n: number): number[] => {
    const own = book.bySpell.get(i) ?? []
    const lists = own.map(k => poisons[k].slice())
    const out: number[] = []
    for (let j = 0; j < n; j++) {
      let v = sp.immediate
      own.forEach((k, m) => (v += book.dots[k].tick * applyPoison(lists[m], book.dots[k].turns, book.dots[k].stack)))
      out.push(v)
    }
    return out
  }
  for (let i = 0; i < a.spells.length; i++) {
    const sp = splits[i]
    if (!sp) continue
    let n = castsAvailable(a, a.spells[i], sp.profile, d.id, 'now')
    if (n <= 0) continue
    const cost = sp.profile.apCost
    if (cost <= 0) {
      for (const v of copies(i, sp, Number.isFinite(n) ? n : 1)) if (v > 0) free.push({ spell: i, value: v })
      continue
    }
    n = Math.min(n, Math.floor(apInt / cost))
    for (const v of copies(i, sp, n)) {
      if (v <= 0 || items.length >= MAX_ITEMS) continue
      const take = new Uint8Array(apInt + 1)
      for (let w = apInt; w >= cost; w--) {
        const x = dpMean[w - cost] + v
        if (x > dpMean[w] + 1e-9) {
          dpMean[w] = x
          take[w] = 1
        }
      }
      items.push({ spell: i, cost, value: v })
      takes.push(take)
    }
  }
  // Plus petit budget atteignant le maximum, puis reconstruction (lancers gratuits d'abord, comme le sac à dos).
  let best = 0
  for (let w = 1; w <= apInt; w++) if (dpMean[w] > dpMean[best] + 1e-9) best = w
  const chosen: { spell: number; value: number }[] = [...free]
  let w = best
  for (let it = items.length - 1; it >= 0 && w > 0; it--) {
    if (!takes[it][w]) continue
    chosen.push(items[it])
    w -= items[it].cost
  }
  const bySpell = new Map<number, number>()
  let value = 0
  const after = poisons.map(l => l.slice())
  for (const x of chosen) {
    const id = a.spells[x.spell].spellId
    value += x.value
    bySpell.set(id, (bySpell.get(id) ?? 0) + x.value)
    for (const k of book.bySpell.get(x.spell) ?? []) applyPoison(after[k], book.dots[k].turns, book.dots[k].stack)
  }
  return { casts: chosen.map(x => a.spells[x.spell].spellId), value, bySpell, after }
}

/** Poisons au début du tour suivant : une échéance tombée par instance, instances épuisées retirées. */
function aged(poisons: Poisons): Poisons {
  return poisons.map(l => l.map(r => r - 1).filter(r => r > 0))
}

/**
 * DPT soutenu de `a` contre `d` sur `turns` tours (voir l'en-tête), non calibré. `a` et `d` doivent avoir des ids et
 * des équipes distincts (fighters.ts). Avec la table de l'IA (`createDptTable`) : lancers entiers (heuristiques du sac
 * à dos), sans suivi des poisons.
 */
export function sustainedDamage(table: DptTableImpl, a: Fighter, d: Fighter, opts: SustainedOptions = {}): SustainedDamage {
  assertDistinct(a, d)
  const turns = Math.max(1, Math.floor(opts.turns ?? 6))
  const ap = Math.max(0, opts.ap ?? a.stats.ap)

  const sim = restingCopy(a)
  const profiles = table.profiles.ofFighter(sim)
  const splits: (SpellSplit | undefined)[] = sim.spells.map((_, i) => {
    const p = profiles[i]
    if (!p || !p.damage.length) return undefined
    const sp = table instanceof TheoryDptTable ? table.split(sim, i, d) : { immediate: table.perCast(sim, i, d).mean, dots: [] }
    return { ...sp, profile: p }
  })
  const book: PoisonBook = { dots: [], bySpell: new Map() }
  splits.forEach((sp, i) => {
    for (const dot of sp?.dots ?? []) {
      book.bySpell.set(i, [...(book.bySpell.get(i) ?? []), book.dots.length])
      book.dots.push({ turns: Math.max(1, Math.min(dot.turns, SUSTAINED_TURNS)), stack: dot.stack, tick: dot.tick })
    }
  })
  const none: Poisons = book.dots.map(() => [])

  // Rafale : premier tour d'un combattant neuf (relances et poisons ignorés).
  const burst = planTurn(sim, d, ap, splits, book, none).value

  // Relances en cours (tours restants, décomptées au début de chaque tour du lanceur).
  let cds: Record<number, number> = {}
  if (opts.initialCooldowns) {
    // Moteur (Engine, entrée en combat) : relance initiale + 1, le décompte ayant lieu au début du tour.
    for (const ks of sim.spells) if (ks.level.initialCooldown > 0) cds[ks.spellId] = ks.level.initialCooldown + 1
  }
  let poisons = none
  const perTurn: number[] = []
  const casts: number[][] = []
  const credits: Map<number, number>[] = []
  // Premier tour de chaque état (relances et poisons, après décompte) : une répétition ferme la période du régime établi.
  const seen = new Map<string, number>()
  let cycle: [number, number] | undefined
  for (let t = 0; t < Math.max(turns, MAX_STEADY_TURNS) && (t < turns || !cycle); t++) {
    cds = decremented(cds)
    if (t > 0) poisons = aged(poisons)
    if (!cycle) {
      const key = stateKey(cds, poisons)
      const first = seen.get(key)
      if (first !== undefined) {
        cycle = [first, t]
        if (t >= turns) break
      } else seen.set(key, t)
    }
    sim.cooldowns = cds
    sim.castsThisTurn = {}
    sim.castsOnTarget = {}
    const plan = planTurn(sim, d, ap, splits, book, poisons)
    perTurn.push(plan.value)
    casts.push(plan.casts)
    credits.push(plan.bySpell)
    poisons = plan.after
    const next = { ...cds }
    for (const spellId of new Set(plan.casts)) {
      const i = sim.spells.findIndex(s => s.spellId === spellId)
      if (i < 0) continue
      const p = profiles[i]
      const cd = Math.max(p.cooldown, p.level.globalCooldown)
      if (cd > 0) next[spellId] = cd
    }
    cds = next
  }
  const avg = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const [from, to] = cycle ?? [Math.max(0, perTurn.length - STEADY_FALLBACK), perTurn.length]
  const steady = avg(perTurn.slice(from, to))
  // Régime établi par sort : lancers et dégâts crédités par tour sur la période.
  const per = new Map<number, { casts: number; damage: number }>()
  const n = to - from
  for (let t = from; t < to; t++) {
    for (const id of casts[t]) {
      const e = per.get(id) ?? { casts: 0, damage: 0 }
      e.casts += 1 / n
      per.set(id, e)
    }
    for (const [id, v] of credits[t]) {
      const e = per.get(id) ?? { casts: 0, damage: 0 }
      e.damage += v / n
      per.set(id, e)
    }
  }
  const steadyBySpell = [...per].map(([spellId, x]) => ({ spellId, casts: x.casts, damage: x.damage }))
  const period = cycle ? cycle[1] - cycle[0] : 0
  perTurn.length = turns
  casts.length = turns
  return { perTurn, mean: avg(perTurn), burst, casts, steady, period, steadyBySpell }
}
