/**
 * CLI de simulation (docs/design/ai.md §15.9) : `npm run sim -- <commande> [options]`.
 *
 * COMPOSITION = ENTRÉE DE L'UTILISATEUR (décision du 2026-10-05) : les classes de l'équipe d'un donjon sont choisies par
 * l'utilisateur — fichier d'équipe `data/teams/<scénario>.json` (équipe par défaut du scénario quand `--team` est
 * absent), `--classes eniripsa,enutrof,cra,cra` ou `--team` (builds exacts) ; le simulateur optimise le reste (builds,
 * variantes de sorts, stratégie θ) — src/optimizer/team/userteam.ts, src/optimizer/builds.ts.
 *
 *   fight <scénario>     un combat (replay animé écrit dans web/public/replays/ + index.json lu par le visualiseur)
 *   batch <scénario>     Monte-Carlo sur N graines CRN (workers), IC de Wilson, arrêt séquentiel, causes d'échec,
 *                        variantes INCERTAINES (--robust), cache de campagne (runs/<campagne>.jsonl), replays notables
 *   optimize <scénario>  builds de la composition de l'utilisateur (presets, stuffs optimisés, criblage + halving
 *                        appariés, variantes, θ) → rapport Markdown + JSON (docs/reports) et meilleur replay
 *   stuff <scénario>     optimiseur de stuff pour UN membre (proxy du scénario) → build JSON réutilisable
 *   report <fichier>     rendu Markdown d'un résultat enregistré (rapport JSON, résumé de batch)
 *   tune <scénario>      réglage de θ (L2) pour l'équipe → fichier θ pour --theta
 *   rewind <scénario>    rembobinage stratégique d'une graine perdue (optimiste, démo)
 *   team <scénario>      recherche AUTOMATIQUE de composition (opt-in, jamais par défaut)
 *   bench                débit du pool (combats/s) pour 1, 2, 4 workers (banc B6 en ligne de commande)
 *   presets              liste des presets (classe, rôle, élément, stuff, PA/PM/PV calculés)
 *
 * Scénarios : identifiant du registre (src/dungeons : `vortex`, `skirmish`, `dummy`), combat de contrôle
 * `control:<carte>:<monstre>[*n][@grade],…` ou miroir `mirror[:<carte>]` (src/optimizer/runner.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { DataStore } from '../data/store'
import { loadDataStore } from '../data/node'
import { openCampaignCache, type FightCache } from '../optimizer/cache'
import { notableSeeds, runBatch } from '../optimizer/montecarlo'
import { defaultPoolSize } from '../optimizer/pool/node'
import { runOne } from '../optimizer/runner'
import { campaignSeeds } from '../optimizer/seeds'
import { failReasons, variantMarginals, variantMinN, worstMarginal, worstVariant } from '../optimizer/stats'
import { PRESETS, validatePreset, type StuffChoice } from '../optimizer/team/presets'
import { compositionClasses } from '../optimizer/team/userteam'
import type { StopRule } from '../optimizer/types'
import {
  bool,
  DEFAULT_TEAM,
  dataDirOf,
  describe,
  fighterTable,
  num,
  parseArgs,
  pct,
  replayDirOf,
  REPO_ROOT,
  saveReplay,
  specOf,
  str,
  teamChoiceOf,
  teamLine,
  withPool,
  writeFightReplay,
  type Args,
} from './common'
import { cmdOptimize, cmdReport, cmdRewind, cmdStuff, cmdTeam, cmdTune } from './optimize'
import { cmdScenario } from './scenario'

export { DEFAULT_TEAM, fighterTable, parseArgs, parseParams, REPLAY_DIR, writeReplay, type Args, type ReplayIndexEntry } from './common'

const COMMANDS = ['fight', 'batch', 'bench', 'presets', 'tune', 'stuff', 'team', 'optimize', 'rewind', 'report', 'scenario'] as const

export function usage(): string {
  return [
    'Usage : npm run sim -- <commande> [options]',
    '',
    '  COMPOSITION = CHOIX DE L\'UTILISATEUR : les classes viennent du fichier d\'équipe du scénario',
    '  (data/teams/<scénario>.json, ex. data/teams/vortex.json = Eniripsa, Enutrof, Crâ, Crâ), de --classes ou de --team ;',
    '  le simulateur optimise les builds (preset, stuff, exos, points, variantes) et la stratégie pour cette composition.',
    '',
    '  fight <scénario>    [équipe] [--ai scripted|fast|standard|deep] [--policy ai|random] [--seed N] [--placement c1,c2,…]',
    '                      [--stuff default|unstuffed|naked|<stuff>] [--robust] [--replay <fichier>|auto|none] [--replay-dir D] [--json]',
    '  batch <scénario>    [équipe] [--ai M] [--runs N] [--workers W] [--master-seed S] [--robust]',
    '                      [--min-n N --max-n N --half-width H] [--campaign nom] [--cache-version v] [--micro prefix12|phase2|poutch]',
    '                      [--replays] [--replay-dir D] [--json]',
    '  optimize <scénario> [--classes C | --team-file F | --team T] [--budget quick|normal|full] [--max-fights N] [--workers W]',
    '                      [--master-seed S] [--keep K] [--screen-seeds N] [--halving 16,32,64] [--validate N]',
    '                      [--screen-kind full|prefix12|phase2] [--variants|--no-variants] [--tune-theta [--theta-paths a,b]] [--no-stuff-search]',
    '                      [--profile balanced|defensive|offensive] [--stuff-iterations N] [--campaign nom|--no-cache]',
    '                      [--id nom] [--out-dir docs/reports] [--save-team [fichier]] [--no-replays] [--dry-run] [--json]',
    '  stuff <scénario>    --member <n°|classe|preset[@stuff]> [équipe] [--profile P] [--iterations N] [--seed S]',
    '                      [--out fichier.json] [--validate N --workers W] [--json]',
    '  report <fichier>    rapport JSON (optimize/team) ou résumé de batch (runs/*.summary.json) → Markdown [--out F.md]',
    '  tune <scénario>     [équipe] [--seeds N] [--keep K] [--generations G] [--population P] [--validate N] [--paths a,b]',
    '                      [--workers W] [--out theta.json]',
    '  rewind <scénario>   [équipe] --seed N [--max-resumes K] [--robust-seeds S] [--replay auto|none|<fichier>]',
    '  scenario <scénario> --enemy-placement N|all [équipe] [--refs K] [--seed S] [--ai M] [--rolls average|random] [--check R]',
    '                      [--out fichier] [--force] [--no-replay] [--json]   scénario de combat figé par placement des monstres',
    '                      (data/scenarios/<scénario>/placement-N.json) ; --from <fichier> [--check R] [--save] : le rejouer',
    '  team <scénario>     RECHERCHE AUTOMATIQUE DE COMPOSITION (opt-in) [--top N] [--t1-seeds N --t1-keep K] [--t2-seeds N',
    '                      --t2-keep K] [--finalists N] [--coopt] [--no-calibrate] [--validate N] [--workers W] [--id nom]',
    '  bench               [--workers 1,2,4] [--runs N] [--ai M] [--scenario S] [équipe]',
    '  presets             [--class iop] [--stuff S]',
    '',
    '  Équipe (--team, --classes et --team-file sont exclusifs ; sans aucune, le fichier d\'équipe du scénario) :',
    '    --team T          builds exacts : membres séparés par des virgules, chacun <preset> ou <classe>[:rôle|élément],',
    '                      stuff facultatif après « @ » (cra_feu_zone@vortex_cra_feu,iop:killer@unstuffed) ; les presets',
    '                      dérivés (« extends », ex. cra_feu_vortex) sont des alias <base>@<stuff>',
    '    --classes C       classes seules, doublons permis (eniripsa,enutrof,cra,cra ≡ eni,enu,cra*2 ≡ 7,3,9,9) : build',
    '                      par défaut de chaque classe pour le scénario (version du scénario de ses presets, ex. cra_feu_vortex)',
    '    --team-file F     fichier d\'équipe (JSON, voir README « Composition de l\'utilisateur »)',
    '    (rien)            fichier du scénario data/teams/<scénario>.json (--teams-dir D), sinon l\'équipe d\'exemple',
    `                      ${DEFAULT_TEAM}`,
    '  Scénario : vortex | skirmish | dummy | control:<carte>:<monstre>[*n][@grade],… | mirror[:<carte>]',
    '  Options communes : --theta θ.json (surcharge), --noise τ (bruit des monstres), --param clé=valeur (répétable par virgules)',
    '  Exemples (Vortex, composition de l\'utilisateur Eniripsa + Enutrof + 2 Crâs, data/teams/vortex.json) :',
    '    npm run sim -- fight vortex --seed 3',
    '    npm run sim -- batch vortex --runs 128 --workers 3',
    '    npm run sim -- optimize vortex --dry-run                (options de chaque membre et combats prévus)',
    '    npm run sim -- optimize vortex --budget quick --workers 3',
    '    npm run sim -- optimize vortex --classes eniripsa,enutrof,cra,cra --budget normal --max-fights 900 --save-team',
    '    npm run sim -- stuff vortex --member 4 --out runs/cra2-build.json',
    '    npm run sim -- fight vortex --param enemyPlacement=3   (placement 3 des monstres, voir VORTEX_PLACEMENTS)',
    '    npm run sim -- scenario vortex --enemy-placement 5 --refs 8 --check 64',
    `  Commandes : ${COMMANDS.join(' | ')}`,
  ].join('\n')
}

// ───────────────────────────── commandes ─────────────────────────────

function cmdFight(a: Args, data: DataStore): number {
  const scenarioId = a.positional[0] ?? 'vortex'
  const choice = teamChoiceOf(a, data, scenarioId)
  const spec = specOf(a, data, scenarioId, 'fast', choice)
  const seed = num(a, 'seed', 1) >>> 0
  const replayFlag = bool(a, 'no-replay') ? 'none' : str(a, 'replay') ?? 'auto'
  const t0 = performance.now()
  // Un seul combat : l'enregistrement ne change pas le combat (§13.2), il n'est fait que si un replay est demandé.
  const res = runOne(data, spec, seed, { record: replayFlag !== 'none' })
  const ms = performance.now() - t0
  const { summary } = res
  if (bool(a, 'json')) console.log(JSON.stringify({ summary, ms, team: choice.options?.map(o => o.id) ?? spec.team.map(m => m.presetId) }, null, 2))
  else {
    console.log(teamLine(choice))
    console.log(`${scenarioId} — ${spec.mode}${spec.playerPolicy === 'random' ? ' (aléatoire)' : ''}, graine ${seed} (${ms.toFixed(0)} ms)\n${describe(summary)}`)
    console.log(fighterTable(res.fight, res.fight.fighters.find(f => f.kind === 'player')?.team ?? 0))
  }
  if (replayFlag !== 'none') {
    const path = writeFightReplay(data, spec, res, replayFlag === 'auto' ? undefined : replayFlag, 'fight', replayDirOf(a))
    console.log(`Replay : ${relative(process.cwd(), path)}`)
  }
  return 0
}

async function cmdBatch(a: Args, data: DataStore): Promise<number> {
  const scenarioId = a.positional[0] ?? 'vortex'
  const choice = teamChoiceOf(a, data, scenarioId)
  const spec = specOf(a, data, scenarioId, 'fast', choice)
  const runs = num(a, 'runs', 100)
  const workers = num(a, 'workers', defaultPoolSize())
  const master = num(a, 'master-seed', 1) >>> 0
  const seeds = campaignSeeds(master, runs)
  const stop: StopRule | undefined = a.flags.has('min-n') || a.flags.has('half-width') || a.flags.has('max-n')
    ? { minN: num(a, 'min-n', 32), maxN: num(a, 'max-n', runs), halfWidth: num(a, 'half-width', 0.03) }
    : undefined
  const campaign = str(a, 'campaign')
  const cache: FightCache | undefined = campaign ? openCampaignCache(campaign, join(REPO_ROOT, 'runs'), str(a, 'cache-version')) : undefined
  const kind = (str(a, 'micro') as 'prefix12' | 'phase2' | 'poutch' | undefined) ?? 'full'
  const t0 = performance.now()
  let last = 0
  let shown = 0
  if (!bool(a, 'json')) console.log(teamLine(choice))
  const run = await withPool(
    workers,
    pool =>
      runBatch(spec, seeds, pool, {
        stop,
        cache,
        kind,
        onProgress: (done, planned) => {
          const t = performance.now()
          if (!bool(a, 'json') && (t - last > 2000 || done === planned)) {
            last = t
            shown = done
            process.stderr.write(`\r${done}/${planned} combats…`)
          }
        },
      }),
    data,
    dataDirOf(a),
  )
  const ms = performance.now() - t0
  // Arrêt séquentiel : la dernière progression affichée peut précéder le N d'arrêt.
  if (!bool(a, 'json')) process.stderr.write(shown !== run.computed + run.cached ? `\r${run.computed + run.cached} combats.\n` : '\n')
  const r = run.result
  // Pire variante : seulement une variante (ou une valeur INCERTAINE) observée assez souvent — avec 11 paramètres tirés
  // indépendamment, presque chaque graine a sa propre variante et une variante vue une fois ne dit rien.
  const minN = variantMinN(r.n)
  const worst = worstVariant(r, minN)
  const worstValue = worstMarginal(run.summaries, minN)
  const fails = failReasons(run.summaries)
  const out = {
    scenarioId,
    mode: spec.mode,
    // Type de combat (micro-scénario `--micro` : « victoire » = micro-scénario réussi) — relu par `report`.
    kind,
    policy: spec.playerPolicy ?? 'ai',
    team: spec.team.map(m => m.presetId),
    builds: choice.options?.map(o => o.id),
    composition: choice.composition && { classes: compositionClasses(choice.composition), source: choice.composition.source, file: choice.composition.file, chosenBy: choice.composition.chosenBy },
    workers,
    masterSeed: master,
    result: r,
    worstVariant: worst,
    worstValue,
    variantMarginals: variantMarginals(run.summaries),
    failReasons: fails,
    computed: run.computed,
    cached: run.cached,
    seconds: ms / 1000,
    fightsPerSecond: run.computed / Math.max(1e-9, ms / 1000),
  }
  const summaryFile = join(REPO_ROOT, 'runs', `${campaign?.replace(/[^A-Za-z0-9._-]+/g, '_') ?? `batch-${scenarioId.replace(/[^A-Za-z0-9]+/g, '-')}-${spec.mode}${kind === 'full' ? '' : `-${kind}`}`}.summary.json`)
  mkdirSync(dirname(summaryFile), { recursive: true })
  // `spec` (équipe et builds complets, θ) : la commande `report` peut rendre ce lot plus tard.
  writeFileSync(summaryFile, JSON.stringify({ ...out, spec, summaries: run.summaries }, null, 1))
  if (bool(a, 'json')) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`${scenarioId} — ${spec.mode}${spec.playerPolicy === 'random' ? ' (aléatoire)' : ''}, ${r.n} combats (${run.computed} joués, ${run.cached} en cache) en ${(ms / 1000).toFixed(1)} s (${out.fightsPerSecond.toFixed(2)} combats/s, ${workers} worker(s))`)
    console.log(`Victoires ${r.wins}/${r.n} = ${pct(r.winRate)}  IC95 Wilson [${pct(r.wilson95[0])} ; ${pct(r.wilson95[1])}]`)
    console.log(`Score moyen ${r.meanScore.toFixed(3)}, tours moyens ${r.meanRounds.toFixed(1)}, p10 PV restants ${pct(r.p10HpLeft)}`)
    const variants = Object.entries(r.byVariant)
    if (variants.length <= 8) for (const [k, v] of variants) console.log(`  variante ${k} : ${v.n} combats, ${pct(v.winRate)}`)
    else {
      // Trop de variantes distinctes (paramètres tirés indépendamment) : effets marginaux par valeur INCERTAINE.
      console.log(`  ${variants.length} variantes distinctes ; effet de chaque règle INCERTAINE (tirée / au défaut) :`)
      for (const m of variantMarginals(run.summaries)) {
        console.log(`    ${`${m.param}=${m.value}`.padEnd(40)} ${String(m.n).padStart(4)} combats ${pct(m.winRate).padStart(7)} (défaut ${pct(m.baseWinRate)}), score ${m.meanScore.toFixed(3)} (défaut ${m.baseMeanScore.toFixed(3)})`)
      }
    }
    if (worst && variants.length > 1) console.log(`  pire variante : ${worst.key} (${pct(worst.winRate)}, ${worst.n} combats)`)
    if (worstValue && variants.length > 1) {
      console.log(`  pire valeur INCERTAINE : ${worstValue.param}=${worstValue.value} (${pct(worstValue.winRate)} sur ${worstValue.n} combats, défaut ${pct(worstValue.baseWinRate)})`)
    }
    for (const f of fails.slice(0, 6)) console.log(`  échec « ${f.reason} » : ${f.n}`)
    console.log(`Résumé : ${relative(process.cwd(), summaryFile)}`)
  }
  if (bool(a, 'replays')) {
    const notable = notableSeeds(run.summaries)
    for (const [label, seed] of Object.entries(notable)) {
      if (seed === undefined) continue
      const path = saveReplay(data, spec, seed, undefined, label, replayDirOf(a), undefined, kind)
      console.log(`Replay ${label} (graine ${seed}) : ${relative(process.cwd(), path)}`)
    }
  }
  return 0
}

async function cmdBench(a: Args, data: DataStore): Promise<number> {
  const scenarioId = str(a, 'scenario') ?? 'vortex'
  const spec = specOf(a, data, scenarioId, 'fast')
  const runs = num(a, 'runs', 32)
  const sizes = (str(a, 'workers') ?? '1,2,4').split(',').map(Number).filter(n => n >= 0)
  const seeds = campaignSeeds(num(a, 'master-seed', 7) >>> 0, runs)
  const rows: { workers: number; seconds: number; fightsPerSecond: number; winRate: number; warmupSeconds: number }[] = []
  const warmSeeds = campaignSeeds(0x5eed, 64)
  for (const w of sizes) {
    await withPool(
      w,
      async pool => {
        // Démarrage (fil, chargeur tsx, données) et préchauffage (conversions paresseuses, JIT) HORS mesure : une graine
        // distincte par worker (§16.6 B6 mesure le débit d'un pool déjà démarré).
        const t0 = performance.now()
        await runBatch(spec, warmSeeds.slice(0, Math.max(1, pool.size) * 2), pool, { chunk: 1 })
        const warm = (performance.now() - t0) / 1000
        const t1 = performance.now()
        const run = await runBatch(spec, seeds, pool)
        const s = (performance.now() - t1) / 1000
        rows.push({ workers: w, seconds: s, fightsPerSecond: runs / s, winRate: run.result.winRate, warmupSeconds: warm })
        console.log(`${w} worker(s) : ${runs} combats ${spec.mode} en ${s.toFixed(2)} s → ${(runs / s).toFixed(2)} combats/s (victoires ${pct(run.result.winRate)} ; démarrage + préchauffage ${warm.toFixed(1)} s hors mesure)`)
      },
      data,
      dataDirOf(a),
    )
  }
  if (os.loadavg()[0] > 0.5) console.log(`(charge moyenne de la machine ${os.loadavg()[0].toFixed(1)} sur ${os.availableParallelism()} cœurs : débit à 4 workers sous-estimé)`)
  if (bool(a, 'json')) console.log(JSON.stringify(rows, null, 2))
  return 0
}

function cmdPresets(a: Args, data: DataStore): number {
  const cls = str(a, 'class')
  const stuff = (str(a, 'stuff') ?? 'default') as StuffChoice
  for (const p of PRESETS) {
    if (cls && !p.className.toLowerCase().includes(cls.toLowerCase()) && !p.id.includes(cls.toLowerCase())) continue
    const r = validatePreset(p, data, stuff)
    const s = r.stats
    console.log(
      `${p.id.padEnd(28)} ${p.className.padEnd(11)} ${p.role.padEnd(8)} ${p.element.padEnd(6)} ${(stuff === 'default' ? p.stuff : stuff).padEnd(9)} ` +
        `${r.valid ? 'OK ' : 'ERR'} ${s.ap} PA ${s.mp} PM ${s.range} PO ${r.maxHp} PV  rotation ${p.rotation.length} sorts` +
        (p.extends ? `  (≡ ${p.extends}@${p.stuff})` : ''),
    )
    if (!r.valid) for (const w of r.warnings) console.log(`    ${w}`)
  }
  return 0
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(usage())
    return 0
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    console.error(`Commande inconnue : ${cmd}\n${usage()}`)
    return 2
  }
  const a = parseArgs(rest)
  try {
    const data = loadDataStore(dataDirOf(a))
    switch (cmd) {
      case 'fight':
        return cmdFight(a, data)
      case 'batch':
        return await cmdBatch(a, data)
      case 'bench':
        return await cmdBench(a, data)
      case 'presets':
        return cmdPresets(a, data)
      case 'optimize':
        return await cmdOptimize(a, data)
      case 'stuff':
        return await cmdStuff(a, data)
      case 'report':
        return cmdReport(a, data)
      case 'tune':
        return await cmdTune(a, data)
      case 'rewind':
        return cmdRewind(a, data)
      case 'team':
        return await cmdTeam(a, data)
      case 'scenario':
        return cmdScenario(a, data)
      default:
        console.error(`« ${cmd} » : commande inconnue`)
        return 2
    }
  } catch (e) {
    console.error(`Erreur : ${(e as Error).message}`)
    return 1
  }
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] && /simulate\.[cm]?[jt]s$/.test(process.argv[1])
if (invokedDirectly) void main(process.argv.slice(2)).then(code => (process.exitCode = code))
