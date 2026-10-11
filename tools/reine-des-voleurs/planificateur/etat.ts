// Instantané d'un combat contre la Reine des Voleurs et sa traduction en combat du moteur.
//
// L'instantané décrit le combat AU DÉBUT du tour d'un Crâ (après l'apparition de sa Bonbombe) : positions, PV,
// bombes (poseur, manche d'apparition, couleur), ordre de jeu. Il vient du journal AnkaBot (journal.ts) ou d'un
// fichier JSON écrit à la main.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDataStore } from '../../../src/data/node'
import { createEngine } from '../../../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../../../src/engine/factory'
import { emptyStats, type Stats } from '../../../src/core/types'
import type { Engine } from '../../../src/engine/engine'
import type { Fighter, FightState } from '../../../src/engine/types'
import { reineScenario } from './regles'

/**
 * Données du jeu : celles de la version EN JEU (3.7 depuis le 2026-10-06), pas celles du dépôt (data/dofusdb, encore en
 * 3.6 pour le reste du projet). Dossier `REINE_DATA`, sinon .cache/data-3.7 (dofusdb/ + maps/137101316.json), produit
 * par `node scripts/fetch-dofusdb.mjs --out=.cache/data-3.7/dofusdb` et une copie de data/maps/137101316.json.
 */
export const ROOT = findRoot()
export const DATA_DIR = process.env.REINE_DATA ?? (existsSync(join(ROOT, '.cache/data-3.7/dofusdb')) ? join(ROOT, '.cache/data-3.7') : join(ROOT, 'data'))
export const data = loadDataStore(DATA_DIR)

/**
 * Racine du dépôt : le dossier courant ou l'un de ses parents qui contient data/dofusdb (le code peut être regroupé
 * ailleurs, par exemple dans la configuration du serveur de Vite), sinon d'après l'emplacement de ce fichier.
 */
function findRoot(): string {
  for (let dir = process.cwd(); ; ) {
    if (existsSync(join(dir, 'data', 'dofusdb'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return fileURLToPath(new URL('../../../', import.meta.url))
}

/** Carte du combat : 137101316 (constaté en jeu le 2026-10-09 ; la salle 137101312 n'est que la carte d'entrée). */
export const MAP_ID = 137101316
export const QUEEN = 3726
export const BOMB = 3725
/** Grades à 4 personnages : Reine grade 1, monstres de vague grade 5 (docs/strategies/reine-des-voleurs §1.2). */
export const GRADES: Record<number, number> = { 3726: 1, 3746: 5, 3747: 5, 3748: 5, 3749: 5, 3750: 5, 3725: 1 }

/** Caractéristiques des Crâs données par le joueur (tools/reine-des-voleurs/v2-en-cours/damage/lib.ts, `CRA`). */
export const CRA_STATS: Stats = {
  ...emptyStats(),
  ap: 12, mp: 5, range: 4, summons: 4, initiative: 2690, wisdom: 171,
  strength: 579, intelligence: 728, chance: 290, agility: 519, power: 169,
  critical: 79, criticalDamage: 95, pushDamage: 14,
  neutralDamage: 56, earthDamage: 67, fireDamage: 84, waterDamage: 38, airDamage: 45,
  spellDamagePct: 10, rangedDamagePct: 6,
  earthRes: 13, fireRes: 23, waterRes: 6, airRes: 2,
  neutralResPct: 9, earthResPct: 16, fireResPct: 16, waterResPct: 28, airResPct: 47,
  rangedResPct: -12, meleeResPct: -6,
  tackleBlock: 34, tackleEvade: 23, apReduction: 19, mpReduction: 17, apParry: 17, mpParry: 3,
}

/**
 * Caractéristiques des Crâs que le serveur n'envoie pas dans ses synchronisations (le reste vient du journal) : dommages
 * critiques estimés sur les coups critiques réels du 2026-10-10 (fidelite.ts, coups mortels exclus : écart médian nul
 * à 180–190 pour chacun des 4 Crâs, 14 à 22 coups sur 20 à 26 dans la fourchette des jets).
 */
export const UNSENT_CRA_STATS: Partial<Stats> = { criticalDamage: 185 }

/** Sorts lancés par les Crâs pendant le combat du 2026-10-09 (journal) : la liste par défaut de chaque Crâ. */
export const DEFAULT_SPELLS = [
  32466, // Tirs Puissants
  32465, // Tirs Éloignés (lance aussi 32558, son sous-sort)
  32460, // Flèche du Jugement
  32446, // Flèche Dévorante
  32454, // Œil pour Œil
  32437, // Œil de Taupe
  32435, // Flèche Glacée
  32429, // Flèche Perforante
  32436, // Flèche d'Immobilisation
  32462, // Flèche de Rédemption
  32453, // Flèche d'Abolition
  32426, // Flèche de Recul
  32428, // Flèche de Dispersion
]

export interface EntitySnap {
  /** Nom affiché (Crâ : nom du personnage ; monstre : nom + identifiant). */
  name: string
  kind: 'cra' | 'monster' | 'bomb'
  /** Identifiant de combat du jeu (journal) : sert à relier les bombes à leur poseur. */
  gameId: number
  /** Monstre ou bombe : identifiant du monstre (3726 Reine, 3725 Bonbombe…). */
  monsterId?: number
  cell: number
  hp?: number
  maxHp?: number
  ap?: number
  mp?: number
  /** Bombe : identifiant de jeu de son poseur, manche d'apparition, bleue ou non. */
  owner?: number
  born?: number
  blue?: boolean
  /** Crâ : sorts disponibles (défaut DEFAULT_SPELLS), et relances restantes au début de son tour (sort → tours). */
  spells?: number[]
  cooldowns?: Record<number, number>
  /** Monstre qui partage ses PV avec celui-ci (copie de la Doublure → Doublure). */
  linkedTo?: number
}

export interface Snapshot {
  mapId: number
  round: number
  /** Identifiant de jeu du Crâ qui commence son tour. */
  active: number
  /** Ordre de jeu (identifiants de jeu, bombes exclues : elles jouent juste après leur poseur). */
  order: number[]
  entities: EntitySnap[]
  /** Origine de l'instantané (journal, heure…). */
  source?: string
}

export interface BuiltFight {
  engine: Engine
  fight: FightState
  /** Combattant du moteur ↔ entité de l'instantané. */
  byGameId: Map<number, Fighter>
  gameIdOf: Map<number, number>
  snap: Snapshot
}

export function buildFight(snap: Snapshot): BuiltFight {
  // Scénario du combat (regles.ts) : pas de fin entre deux vagues, bombes et monstres arrivants invulnérables.
  const engine = createEngine(data, reineScenario)
  const map = data.map(snap.mapId)
  if (!map) throw new Error(`Carte ${snap.mapId} absente de data/maps`)
  const fighters: Fighter[] = []
  const ents: EntitySnap[] = []
  for (const e of snap.entities) {
    let f: Fighter
    if (e.kind === 'cra') {
      f = createPlayerFighter(data, { name: e.name, breedId: 9, level: 200, stats: { ...CRA_STATS }, maxHp: e.maxHp ?? 3342, spellIds: e.spells ?? DEFAULT_SPELLS, team: 0, cell: e.cell })
    } else {
      const id = e.monsterId ?? BOMB
      f = createMonsterFighter(data, { monsterId: id, grade: GRADES[id] ?? 5, team: e.kind === 'bomb' ? 0 : 1, cell: e.cell })
      f.name = e.name
    }
    fighters.push(f)
    ents.push(e)
  }
  const fight = engine.createFight({ map, fighters, options: { seed: 1, rollMode: 'average', record: true, maxRounds: 999 } })
  const byGameId = new Map<number, Fighter>()
  const gameIdOf = new Map<number, number>()
  fight.fighters.forEach((f, i) => {
    const e = ents[i]
    byGameId.set(e.gameId, f)
    gameIdOf.set(f.id, e.gameId)
    if (e.maxHp !== undefined) f.maxHp = e.maxHp
    if (e.hp !== undefined) f.hp = Math.min(e.hp, f.maxHp)
    f.ap = e.ap ?? f.stats.ap
    f.mp = e.mp ?? f.stats.mp
    if (e.cooldowns) f.cooldowns = { ...e.cooldowns }
    else if (e.kind === 'monster' && e.monsterId !== undefined) f.cooldowns = monsterCooldowns(e.monsterId, snap.round)
  })
  // Bombes : invocations de leur poseur (Crâ ou monstre) ; copie de la Doublure : invocation de l'original (PV partagés,
  // regles.ts).
  for (const e of ents) {
    const ownerId = e.owner ?? e.linkedTo
    if (ownerId === undefined) continue
    const f = byGameId.get(e.gameId)
    const owner = byGameId.get(ownerId)
    if (f && owner) f.summonerId = owner.id
  }
  // L'événement de départ (affichage, replays) reprend PV, PA, PM et invocateurs de l'instantané.
  const start = fight.events[0]
  if (start?.t === 'fightStart') {
    start.fighters = start.fighters.map(s => {
      const f = fight.fighters[s.id]
      return { ...s, hp: f.hp, maxHp: f.maxHp, ap: f.ap, mp: f.mp, summonerId: f.summonerId, role: f.monsterId === QUEEN ? 'boss' : s.role }
    })
  }
  fight.round = snap.round
  return { engine, fight, byGameId, gameIdOf, snap }
}

export const isBomb = (e: EntitySnap) => e.kind === 'bomb'

/**
 * Relances d'un monstre AVANT le début de son prochain tour, à la manche `nextRound` (le moteur les décompte au début
 * du tour : un sort n'est lançable que si sa relance vaut 0 après ce décompte). Relance initiale (Brume, Doublage : 3,
 * donc lançables à partir de la manche 4) et relance après un lancer (`lastCast` : sort → manche du dernier lancer).
 */
export function monsterCooldowns(monsterId: number, nextRound: number, lastCast: Map<number, number> = new Map()): Record<number, number> {
  const out: Record<number, number> = {}
  const grade = GRADES[monsterId] ?? 5
  for (const id of data.monster(monsterId)?.spells ?? []) {
    const lv = data.spellLevel(id, { grade })
    if (!lv) continue
    let v = Math.max(0, lv.initialCooldown + 2 - nextRound)
    const r = lastCast.get(id)
    if (r !== undefined && lv.minCastInterval > 0) v = Math.max(v, r + lv.minCastInterval - nextRound + 1)
    if (v > 0) out[id] = v
  }
  return out
}
