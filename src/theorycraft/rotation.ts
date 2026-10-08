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
 * Point de départ : début de combat SANS relance initiale (tous les sorts prêts au tour 1 ; option `initialCooldowns`
 * pour les relances initiales du moteur). Sortie (`SustainedDamage`, types.ts) :
 *  - `perTurn`, `casts`, `mean` : les `turns` premiers tours et leur moyenne. Cette moyenne dépend de l'horizon : un sort
 *    de relance c est lancé ceil(turns / c) fois (dès le tour 1) au lieu de turns / c en régime établi, ce qui la tire
 *    vers la rafale (mesuré, presets de base contre un boss neutre : jusqu'à +2,05 % au-dessus du régime établi sur
 *    6 tours, Pandawa Saoul et Sram poisons) ;
 *  - `steady`, `period` : RÉGIME ÉTABLI (« relances amorties » du contrat), indépendant de l'horizon. La suite des tours
 *    est déterministe et ne dépend que des relances en cours au début du tour (compteurs remis à zéro, états figés) :
 *    elle devient périodique dès qu'un état de relances se répète ; `steady` est la moyenne d'une période. C'est la
 *    valeur à utiliser pour classer ;
 *  - `burst` : rafale (un tour sur un combattant neuf, relances ignorées : `turn(…, 'next')`).
 * Ni la moyenne ni le régime établi ne dépassent la rafale (chaque tour choisit parmi un sous-ensemble des sorts, avec
 * les mêmes PA).
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
 *  - ni invocations, glyphes, pièges, bombes, arme ; DoT × min(durée, 2) × 0,8 et effets différés × 0,8 (heuristiques
 *    du sac à dos) ; aucune contrainte de position, de PM ni de ligne de vue ;
 *  - états du lanceur et de la cible FIGÉS (posture : stances.ts ; phase du boss : fighters.ts) ;
 *  - relances initiales (`initialCooldown`) ignorées par défaut (option `initialCooldowns`) : sans effet sur `steady`
 *    tant que le même cycle est atteint, elles ne changent que les premiers tours.
 *
 * Les combattants passés ne sont pas modifiés : la simulation travaille sur des copies superficielles (relances et
 * compteurs propres, caractéristiques et sorts partagés en lecture seule ; mêmes empreintes de cache DPT).
 * Déterministe (aucun aléa, ordre des sorts du combattant).
 */
import type { DptTableImpl } from '../ai/core/dpt'
import type { Fighter } from '../engine/types'
import { assertDistinct } from './fighters'
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

/** Clé d'un état de relances (ordre des sorts indifférent). */
function cooldownKey(cds: Readonly<Record<number, number>>): string {
  return Object.keys(cds)
    .map(Number)
    .sort((x, y) => x - y)
    .map(k => `${k}:${cds[k]}`)
    .join(',')
}

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

/**
 * DPT soutenu de `a` contre `d` sur `turns` tours (voir l'en-tête), non calibré. `a` et `d` doivent avoir des ids et
 * des équipes distincts (fighters.ts).
 */
export function sustainedDamage(table: DptTableImpl, a: Fighter, d: Fighter, opts: SustainedOptions = {}): SustainedDamage {
  assertDistinct(a, d)
  const turns = Math.max(1, Math.floor(opts.turns ?? 6))
  const ap = Math.max(0, opts.ap ?? a.stats.ap)

  // Rafale : meilleur tour d'un combattant neuf (relances ignorées).
  const burst = table.turn(restingCopy(a), d, ap, 'next').mean

  const sim = restingCopy(a)
  const profiles = table.profiles.ofFighter(sim)
  const indexOf = new Map<number, number>()
  sim.spells.forEach((s, i) => indexOf.set(s.spellId, i))
  // Relances en cours (tours restants, décomptées au début de chaque tour du lanceur).
  let cds: Record<number, number> = {}
  if (opts.initialCooldowns) {
    // Moteur (Engine, entrée en combat) : relance initiale + 1, le décompte ayant lieu au début du tour.
    for (const ks of sim.spells) if (ks.level.initialCooldown > 0) cds[ks.spellId] = ks.level.initialCooldown + 1
  }
  const perTurn: number[] = []
  const casts: number[][] = []
  // Premier tour de chaque état de relances (après décompte) : une répétition ferme la période du régime établi.
  const seen = new Map<string, number>()
  let cycle: [number, number] | undefined
  for (let t = 0; t < Math.max(turns, MAX_STEADY_TURNS) && (t < turns || !cycle); t++) {
    cds = decremented(cds)
    if (!cycle) {
      const key = cooldownKey(cds)
      const first = seen.get(key)
      if (first !== undefined) {
        cycle = [first, t]
        if (t >= turns) break
      } else seen.set(key, t)
    }
    sim.cooldowns = cds
    sim.castsThisTurn = {}
    sim.castsOnTarget = {}
    const r = table.turn(sim, d, ap, 'now')
    perTurn.push(r.mean)
    // Résultat partagé (cache du sac à dos) : copié aussitôt.
    const list = r.casts.slice()
    casts.push(list)
    const next = { ...cds }
    for (const spellId of new Set(list)) {
      const i = indexOf.get(spellId)
      if (i === undefined) continue
      const p = profiles[i]
      const cd = Math.max(p.cooldown, p.level.globalCooldown)
      if (cd > 0) next[spellId] = cd
    }
    cds = next
  }
  const avg = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const steadyTurns = cycle ? perTurn.slice(cycle[0], cycle[1]) : perTurn.slice(-STEADY_FALLBACK)
  const steady = avg(steadyTurns)
  const period = cycle ? cycle[1] - cycle[0] : 0
  perTurn.length = turns
  casts.length = turns
  return { perTurn, mean: avg(perTurn), burst, casts, steady, period }
}
