// Menaces au pire cas : quels monstres peuvent, à leur prochain tour, lancer un sort offensif sur une case donnée.
//
// Pour chaque monstre : toutes les cases atteignables avec ses PM (sans tacle), tous ses sorts offensifs (dégâts,
// déplacement, état ou retrait sur un ennemi), relances et limites de lancers ignorées, PA pleins. La Reine peut en
// plus échanger sa place avec un combattant (Mort en Sursis, 2 lancers par tour, 1 par cible) puis repartir avec ses
// PM restants : c'est ainsi qu'elle a avancé pendant le combat du 2026-10-09.
// Hypothèse : les autres combattants ne bougent pas d'ici là (même limite que bombes.ts).
import { canCast } from '../../../src/engine/cast'
import { reachableCells } from '../../../src/engine/move'
import { createSpellProfileIndex, type SpellProfileX } from '../../../src/ai/core/spellProfile'
import type { Engine } from '../../../src/engine/engine'
import type { Fighter, FightState, KnownSpell } from '../../../src/engine/types'
import { cellToPoint, distance, pointToCell } from '../../../src/map/geometry'
import { compileZone, isCellInZone } from '../../../src/map/zones'
import { QUEEN } from './etat'

/** Mort en Sursis (Reine). */
export const DEATH_ROW = 4694
const TERRISTOCRATE = 3747
/** Fumérus (Terristocrate) : téléportation de 1 à 4 cases en ligne. */
const FUMERUS = 4774
/** Bombe Illicale (Terristocrate). */
export const ILLICIT_SPELL = 4771

export interface Threat {
  monster: number // identifiant moteur
  spell: number
  from: number
  /** Case d'échange préalable (Reine) : elle a d'abord pris la place du combattant qui s'y trouvait. */
  viaSwap?: number
}

function offensive(p: SpellProfileX): boolean {
  return (
    p.damage.some(l => l.sides.enemy) ||
    p.moves.some(l => l.sides.enemy && !l.onCaster) ||
    p.states.some(l => l.sides.enemy && l.on !== 'self' && !l.remove) ||
    p.removals.some(l => l.sides.enemy)
  )
}

/**
 * Zone d'un sort lancé sur soi (portée 0) qui touche les ennemis autour du lanceur : Attentat du Terristocrate, cercle
 * de 4 cases (combats du 2026-10-11 : jusqu'à 3 Crâs touchés, 600 à 1 135 PV chacun ; 18:35, Lamouit achevée).
 */
function selfArea(sp: KnownSpell) {
  if (sp.level.range > 0) return undefined
  const e = sp.level.effects.find(x => (x.targetMask ?? '').includes('A') && Number(x.zone?.size ?? 0) > 0)
  return e?.zone
}

/**
 * Plus grande distance (|dx| + |dy|) entre le centre d'une zone et une case qu'elle touche : le rayon pour un cercle
 * ou un anneau, sinon le double du demi-côté de sa boîte englobante (carrés, diagonales…).
 */
function areaReach(zone: NonNullable<ReturnType<typeof selfArea>>): number {
  const z = compileZone(zone)
  return z.shape === 'C' || z.shape === 'O' || z.shape === 'P' ? z.span : 2 * z.span
}

interface Origin { cell: number; mpLeft: number; viaSwap?: number; swapsLeft: number; usedOn?: number }

/** Remet un combattant « en début de tour » (PA/PM pleins, aucune relance ni limite de lancer). */
function freshTurn(f: Fighter) {
  f.ap = f.stats.ap
  f.mp = f.stats.mp
  f.cooldowns = {}
  f.castsThisTurn = {}
  f.castsOnTarget = {}
}

/**
 * Menaces sur la case `target` si le Crâ `me` s'y trouve. Travaille sur un clone de `fight` (rien n'est modifié).
 */
export function threatsOn(engine: Engine, fight: FightState, me: Fighter, target: number): Threat[] {
  const s = engine.cloneFightForSim(fight)
  s.fighters[me.id].cell = target
  return scan(engine, s, [me.id]).get(me.id) ?? []
}

/**
 * Menaces sur plusieurs Crâs, chacun sur sa case actuelle : ce que chaque monstre peut atteindre (PM, échanges de la
 * Reine, Fumérus du Terristocrate) est cherché une fois pour tous au lieu d'une fois par Crâ. Même résultat que
 * threatsOn(…, crâ, crâ.cell) pour chacun (premières menaces trouvées, dans le même ordre). Rend Crâ (identifiant
 * moteur) → menaces. Travaille sur un clone de `fight`.
 */
export function threatsOnCras(engine: Engine, fight: FightState, cras: readonly Fighter[]): Map<number, Threat[]> {
  if (!cras.length) return new Map()
  return scan(engine, engine.cloneFightForSim(fight), cras.map(c => c.id))
}

/** Recherche commune, sur le clone `s` : chaque Crâ visé garde la première menace trouvée par monstre. */
function scan(engine: Engine, s: FightState, targetIds: number[]): Map<number, Threat[]> {
  const out = new Map<number, Threat[]>(targetIds.map(id => [id, []]))
  const targets = targetIds.map(id => s.fighters[id])
  const team = targets[0].team
  const profiles = createSpellProfileIndex(engine)
  for (const m of s.fighters) {
    // (case inconnue : invisible hors de la carte)
    if (!m.alive || m.team === team || m.cell < 0) continue
    const home = m.cell
    // Bombe Illicale prête à son prochain tour (relance décomptée au début du tour) : cherchée à part, c'est la menace
    // qui tue (formation.ts) ; sinon retirée de ses sorts.
    const illicitReady = m.monsterId === TERRISTOCRATE && (m.cooldowns[ILLICIT_SPELL] ?? 0) <= 1
    freshTurn(m)
    const maxRange = (sp: KnownSpell) => sp.level.range + (sp.level.rangeBoostable ? Math.max(0, m.stats.range) : 0)
    // (portée 0 ou case libre exigée, Fumérus : jamais sur la case du Crâ ; sauf zone autour du lanceur, Attentat)
    const all: KnownSpell[] = m.spells.filter(sp => (maxRange(sp) > 0 ? !sp.level.needFreeCell : !!selfArea(sp)) && offensive(profiles.of(sp.level)))
    const others = all.filter(sp => sp.spellId !== ILLICIT_SPELL)
    const illicit = all.filter(sp => sp.spellId === ILLICIT_SPELL)
    // (zone et portée de chaque sort calculées une fois par monstre, pas à chaque case essayée)
    const prep = (list: KnownSpell[]) => list.map(sp => ({ sp, area: selfArea(sp), reach: maxRange(sp) + 1 }))
    let spells = prep(m.monsterId === TERRISTOCRATE ? others : all)
    const castOpts = { fromCell: -1, ignoreAp: true }
    // Plus longue portée (ou zone autour de lui) de ses sorts, en distance : sert à écarter d'avance ce qu'il ne peut
    // pas atteindre (même résultat, moins de cases essayées).
    let reachMax = 0
    for (const sp of all) {
      const area = selfArea(sp)
      reachMax = Math.max(reachMax, area ? areaReach(area) : maxRange(sp) + 1)
    }
    const ms = m.monsterId === QUEEN ? m.spells.find(sp => sp.spellId === DEATH_ROW) : undefined
    // Cases atteintes avec ses PM depuis sa case de départ : les mêmes pour les deux recherches du Terristocrate.
    let walked: Origin[] | undefined
    // Crâs que ce monstre n'atteint pas encore ; chacun en sort à sa première menace.
    let pending: Fighter[] = []
    const tryFrom = (o: Origin) => {
      for (let i = 0; i < pending.length; i++) {
        const t = pending[i]
        // (échange de la Reine avec ce Crâ : pas pour le menacer lui-même)
        if (o.usedOn === t.id) continue
        castOpts.fromCell = o.cell
        for (const x of spells) {
          if (x.area ? isCellInZone(x.area, t.cell, o.cell, o.cell) : distance(o.cell, t.cell) <= x.reach &&
            canCast(engine, s, m, x.sp, t.cell, castOpts) === null) {
            out.get(t.id)!.push({ monster: m.id, spell: x.sp.spellId, from: o.cell, viaSwap: o.viaSwap })
            pending.splice(i--, 1)
            break
          }
        }
      }
      return pending.length === 0
    }
    // Rend vrai quand tous les Crâs visés sont menacés.
    const search = (): boolean => {
      if (!walked) {
        walked = []
        for (const [cell, cost] of reachableCells(s, m, engine, m.mp).cost) walked.push({ cell, mpLeft: m.mp - cost, swapsLeft: 2 })
      }
      const origins = walked
      for (const o of origins) if (tryFrom(o)) return true
      // Reine : échange de place avec un autre combattant par Mort en Sursis, puis nouveau départ.
      if (ms) {
        const partners = s.fighters.filter(f => f.alive && f.id !== m.id && f.monsterId !== 3725)
        outer: for (const o of origins) {
          for (const p of partners) {
            // (un partenaire qui est le seul Crâ encore à menacer : rien à chercher)
            if (pending.every(t => t.id === p.id)) continue
            if (distance(o.cell, p.cell) > maxRange(ms) + 1) continue
            // (aucun Crâ restant à portée depuis la case de p avec les PM qui lui resteraient : échange sans effet)
            if (!pending.some(t => t.id !== p.id && distance(p.cell, t.cell) <= o.mpLeft + reachMax)) continue
            if (canCast(engine, s, m, ms, p.cell, { fromCell: o.cell, ignoreAp: true }) !== null) continue
            // échange : la Reine prend la case de p, p prend la sienne (o.cell)
            const pCell = p.cell
            m.cell = pCell
            p.cell = o.cell
            let done = false
            for (const [cell] of reachableCells(s, m, engine, o.mpLeft).cost) {
              if (tryFrom({ cell, mpLeft: 0, viaSwap: pCell, swapsLeft: 1, usedOn: p.id })) {
                done = true
                break
              }
            }
            p.cell = pCell
            m.cell = home
            if (done) break outer
          }
        }
        if (!pending.length) return true
      }
      // Terristocrate : téléportation par Fumérus (1 à 4 cases en ligne) avant ou après ses PM. Journaux des combats du
      // 2026-10-10 et 2026-10-11 : Bombe Illicale posée jusqu'à 14 cases de sa case de début de tour (Fumérus, puis 4 PM,
      // puis portée 6) ; sans Fumérus, la menace s'arrêtait à 10 cases.
      const fum = m.monsterId === TERRISTOCRATE ? m.spells.find(sp => sp.spellId === FUMERUS) : undefined
      if (fum) {
        const seen = new Set<number>()
        const teleports = (from: number) => {
          const out2: number[] = []
          const p = cellToPoint(from)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let k = 1; k <= 4; k++) {
              const c = pointToCell(p.x + dx * k, p.y + dy * k)
              if (c === undefined || c < 0) break
              if (engine.isCellFree(s, c) && canCast(engine, s, m, fum, c, { fromCell: from, ignoreAp: true }) === null) out2.push(c)
            }
          }
          return out2
        }
        let done = false
        // Fumérus d'abord, puis tous ses PM.
        tele: for (const c of teleports(home)) {
          m.cell = c
          for (const [cell] of reachableCells(s, m, engine, m.mp).cost) {
            if (seen.has(cell)) continue
            seen.add(cell)
            if (tryFrom({ cell, mpLeft: 0, swapsLeft: 0 })) {
              done = true
              break tele
            }
          }
        }
        m.cell = home
        // Ses PM d'abord, puis Fumérus.
        if (!done) {
          walk: for (const o of origins) {
            m.cell = o.cell
            for (const c of teleports(o.cell)) {
              if (seen.has(c)) continue
              seen.add(c)
              if (tryFrom({ cell: c, mpLeft: 0, swapsLeft: 0 })) {
                done = true
                break walk
              }
            }
          }
        }
      }
      m.cell = home
      return !pending.length
    }
    // Crâs hors d'atteinte quoi qu'il fasse (tous ses PM, plus Fumérus ou un échange de la Reine, plus longue portée
    // ou zone de ses sorts) : écartés d'avance, même résultat.
    const fum = m.monsterId === TERRISTOCRATE && m.spells.some(sp => sp.spellId === FUMERUS) ? 4 : 0
    const swap = ms ? maxRange(ms) + 1 : 0
    const bound = m.mp + fum + swap + reachMax
    pending = targets.filter(x => distance(home, x.cell) <= bound)
    if (!pending.length) continue
    if (illicitReady && illicit.length) {
      spells = prep(illicit)
      if (search()) continue
      spells = prep(others)
    }
    if (spells.length) search()
  }
  return out
}
