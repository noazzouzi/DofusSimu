/**
 * Commande `scenario` : scénarios de combat (« combat orchestré ») par placement des monstres — src/optimizer/script.ts.
 *
 *   scenario <scénario> --enemy-placement N|all [équipe] [--refs K] [--seed S] [--ai M] [--rolls average|random]
 *            [--check R] [--out fichier] [--no-replay] [--replay-dir D] [--json]
 *     Pour chaque placement : K combats de référence joués par l'IA (graines S, S+1…), chacun rejoué R fois avec d'autres
 *     dés ; le plus robuste (victoire d'abord, puis tours tenus à l'identique) est écrit dans
 *     data/scenarios/<scénario>/placement-<N>.json (+ replay de la référence dans web/public/replays).
 *   scenario --from <fichier> [--check R] [--save]
 *     Rejoue un scénario existant (R tirages de dés) ; `--save` met à jour son bilan.
 *
 * Les dés des rejeux sont les mêmes d'un scénario à l'autre (`checkSeeds`) : les bilans sont comparables.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { mix32 } from '../core/hash'
import type { DataStore } from '../data/store'
import { VORTEX_PLACEMENT_COUNT } from '../dungeons/vortex/constants'
import type { RollMode } from '../engine/types'
import { recordScript, runScript, summarizeChecks, type FightScript, type ScriptCheck } from '../optimizer/script'
import type { FightSpec } from '../optimizer/types'
import { bool, num, REPO_ROOT, replayDirOf, specOf, str, teamChoiceOf, teamLine, writeFightReplay, type Args } from './common'

/** Dossier des scénarios de combat. */
export const SCRIPTS_DIR = join(REPO_ROOT, 'data', 'scenarios')

/** Graines de dés des rejeux (fixes : bilans comparables entre scénarios). */
export function checkSeeds(n: number): number[] {
  return Array.from({ length: n }, (_, k) => mix32(0x5c41a7, k + 1) >>> 0)
}

/** Bilan stocké dans un fichier de scénario. */
export interface StoredCheck extends ScriptCheck {
  diceSeeds: number[]
  checkedAt: string
}

export type StoredScript = FightScript & { check?: StoredCheck }

function check(data: DataStore, script: FightScript, n: number): StoredCheck {
  const diceSeeds = checkSeeds(n)
  const runs = diceSeeds.map(s => runScript(data, script, s))
  return { ...summarizeChecks(script, runs), diceSeeds, checkedAt: new Date().toISOString() }
}

/** Tour de jeu jusqu'auquel au moins `share` des rejeux restent conformes. */
function roundHeld(script: FightScript, c: ScriptCheck, share: number): number {
  let k = 0
  while (k < c.survival.length && c.survival[k] >= share) k++
  return k >= script.turns.length ? script.turns.at(-1)!.round : (script.turns[k]?.round ?? 0)
}

/** Tours tenus en moyenne (part de la longueur du script). */
const meanHeld = (c: ScriptCheck) => c.survival.reduce((a, s) => a + s, 0) / Math.max(1, c.survival.length)

/** Ordre de préférence entre scénarios : victoire de la référence, rejeux conformes, tours tenus en moyenne. */
function compareScripts(a: { win: boolean; c: ScriptCheck }, b: { win: boolean; c: ScriptCheck }): number {
  return Number(a.win) - Number(b.win) || a.c.conform - b.c.conform || meanHeld(a.c) - meanHeld(b.c)
}

function describeCheck(script: FightScript, c: ScriptCheck): string[] {
  const lines = [
    `  rejeux conformes jusqu'au bout : ${c.conform}/${c.runs} ; 90 % tiennent jusqu'au tour de jeu ${roundHeld(script, c, 0.9)}, ` +
      `50 % jusqu'au tour ${roundHeld(script, c, 0.5)} (combat de ${script.reference.rounds} tours, ${script.turns.length} tours de combattants)`,
  ]
  for (const b of c.breaks.slice(0, 6)) {
    lines.push(`  ${b.count}× tour ${b.round} (#${b.index}) ${b.fighter} — ${b.kind === 'monster' ? 'monstre' : b.kind === 'order' ? 'ordre des tours' : b.kind === 'action' ? 'action impossible' : 'fin'} : attendu « ${b.expected} », joué « ${b.actual} »`)
  }
  return lines
}

export function cmdScenario(a: Args, data: DataStore): number {
  const n = num(a, 'check', 64)
  const from = str(a, 'from')
  if (from) {
    const path = resolve(from)
    const script = JSON.parse(readFileSync(path, 'utf8')) as StoredScript
    const c = check(data, script, n)
    console.log(`${relative(process.cwd(), path)} — placement ${script.enemyPlacement}, référence ${script.reference.win ? 'VICTOIRE' : 'défaite'} en ${script.reference.rounds} tours`)
    for (const l of describeCheck(script, c)) console.log(l)
    if (bool(a, 'save')) {
      writeFileSync(path, JSON.stringify({ ...script, check: c }))
      console.log('Bilan enregistré.')
    }
    return 0
  }
  const scenarioId = a.positional[0] ?? 'vortex'
  const which = str(a, 'enemy-placement')
  if (!which) throw new Error('--enemy-placement N (1 à 10) ou all attendu')
  const placements = which === 'all' ? Array.from({ length: VORTEX_PLACEMENT_COUNT }, (_, i) => i + 1) : which.split(',').map(Number)
  if (placements.some(p => !Number.isInteger(p) || p < 1 || p > VORTEX_PLACEMENT_COUNT)) throw new Error(`--enemy-placement : 1 à ${VORTEX_PLACEMENT_COUNT} ou all`)
  const choice = teamChoiceOf(a, data, scenarioId)
  const base = specOf(a, data, scenarioId, 'fast', choice)
  const refs = num(a, 'refs', 4)
  const seed0 = num(a, 'seed', 1) >>> 0
  const rollMode = (str(a, 'rolls') ?? 'average') as RollMode
  if (rollMode !== 'average' && rollMode !== 'random') throw new Error('--rolls : average|random')
  const json = bool(a, 'json')
  if (!json) console.log(teamLine(choice))
  const results: { placement: number; file: string; check: StoredCheck; win: boolean; rounds: number }[] = []
  for (const placement of placements) {
    const spec: FightSpec = { ...base, params: { ...(base.params ?? {}), enemyPlacement: placement } }
    let best: { script: StoredScript; run: ReturnType<typeof recordScript>['run']; c: StoredCheck } | undefined
    for (let k = 0; k < refs; k++) {
      const seed = (seed0 + k) >>> 0
      const t0 = performance.now()
      const { script, run } = recordScript(data, spec, seed, { rollMode })
      const c = check(data, script, n)
      if (!json) {
        console.log(`Placement ${placement}, graine ${seed} : ${run.summary.win ? 'VICTOIRE' : 'défaite'} en ${run.summary.rounds} tours (${((performance.now() - t0) / 1000).toFixed(0)} s)`)
        for (const l of describeCheck(script, c).slice(0, 2)) console.log(l)
      }
      if (!best || compareScripts({ win: run.summary.win, c }, { win: best.script.reference.win, c: best.c }) > 0) best = { script: { ...script, check: c }, run, c }
    }
    if (!best) continue
    const file = resolve(str(a, 'out') && placements.length === 1 ? str(a, 'out')! : join(SCRIPTS_DIR, scenarioId, `placement-${placement}.json`))
    if (existsSync(file) && !bool(a, 'force')) {
      const old = JSON.parse(readFileSync(file, 'utf8')) as StoredScript
      if (old.check && compareScripts({ win: old.reference.win, c: old.check }, { win: best.script.reference.win, c: best.c }) > 0) {
        if (!json) console.log(`  ${relative(process.cwd(), file)} est plus robuste : conservé (--force pour le remplacer).`)
        continue
      }
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(best.script))
    results.push({ placement, file, check: best.c, win: best.script.reference.win, rounds: best.script.reference.rounds })
    if (!json) {
      console.log(`→ Placement ${placement} : graine ${best.script.reference.seed} retenue → ${relative(process.cwd(), file)}`)
      for (const l of describeCheck(best.script, best.c)) console.log(l)
    }
    if (!bool(a, 'no-replay')) {
      const title = `${scenarioId === 'vortex' ? 'Œil de Vortex' : scenarioId} — scénario du placement ${placement} (référence, graine ${best.script.reference.seed}) : ${best.script.reference.win ? 'victoire' : 'défaite'} en ${best.script.reference.rounds} tours`
      const path = writeFightReplay(data, spec, best.run, join(replayDirOf(a), `${scenarioId}-scenario-placement-${placement}.json`), 'scenario', replayDirOf(a), title)
      if (!json) console.log(`  Replay : ${relative(process.cwd(), path)}`)
    }
  }
  if (json) console.log(JSON.stringify(results, null, 2))
  return 0
}
