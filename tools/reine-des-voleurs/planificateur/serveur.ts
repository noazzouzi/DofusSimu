// Serveur de plans de la Reine des Voleurs : le récepteur du journal AnkaBot (scripts/fightlog-server.mjs, même port,
// mêmes fichiers data/fightlogs/…) plus la route POST /plan, appelée par tools/ankabot/ReineIA.lua au début de chaque
// tour d'un Crâ (et après un écart, pour la suite du tour).
//
//   npx tsx tools/reine-des-voleurs/planificateur/serveur.ts      (ou tools/ankabot/lancer_serveur_reine.cmd)
//
// Le fil principal ne fait que recevoir et répondre : la reconstitution et la recherche tournent dans un fil à part
// (serveur-calcul.ts). Sinon un calcul de 1 à 4 s retient les envois des journaux AnkaBot, dont les scripts restent
// occupés : AnkaBot passe alors leurs tours (combat du 2026-10-10, manches 5 à 7).
//
// Pour un plan : les journaux des 4 personnages, gardés en mémoire, sont fusionnés tour par tour (tools/fightlog/
// fusion.ts : chaque tour vient d'un personnage qui ne le joue pas) ; le combat est reconstitué et le moteur recalé
// dessus (fidelite.ts, mode rapide) jusqu'à l'état exact du tour en cours ; le planificateur de formation
// (formation.ts) cherche le tour. Le serveur attend (au plus `attente` ms) que le journal ait rattrapé le personnage :
// son tour commencé, sa bombe posée, sa case et ses PA / PM.
//
// Requête (texte, une clé par ligne) : POST /plan?c=<personnage>
//   case=<case>  pa=<PA>  pm=<PM>  colonne=<Nom>=<case>;<Nom>=<case>…  attente=<ms>  (défaut REINE_ATTENTE_MS, 4000)
//   refus=<sort>@<case>@<depuis>;…  (sorts refusés pendant ce tour : pas replanifiés)
//   sonde=1 [derniere=1]  (par sondes : réponse immédiate « attendre <raison> » tant que le plan n'est pas prêt, calcul
//                          en arrière-plan ; derniere=1 : planifier même si le journal est en retard)
//   longue=<ms>  (sonde longue, 3000 au plus : la réponse attend le plan jusqu'à ce délai, puis « attendre »)
// Réponse (texte, une ligne par élément) :
//   plan <note> <dégâts> <explosions> <case de fin> <ms> [desynchro]
//   deplacer <case,case,…> <coin,coin,…>
//   sort <sort> <case> <cible : soi|case|ennemi|bombe|allie> <espèce ou 0> <identifiant de jeu ou 0> <case de départ>
//   suite reine <milieu> <cases couvertes>   (Reine sous Brume, brume.ts : le plan s'arrête après la Flèche Perforante
//                                             qui la cherche ; redemander la suite du tour)
//   fin
// ou « aucun <raison> » (pas de tour de ce personnage en cours dans le journal, ou aucun plan).
// Chaque plan est aussi écrit dans data/fightlogs/<date>/plans-<heure>.jsonl (état résumé, plan, durées).
// Variables : FIGHTLOG_PORT, FIGHTLOG_DIR (comme le récepteur), REINE_ATTENTE_MS, REINE_CHEF, REINE_FILS.
//
// Plusieurs fils de calcul (REINE_FILS, défaut : 6, au plus la moitié des cœurs) : chacun reçoit tout le journal et
// cherche sa part du plan (formation.ts, partition par case de tir) ; le serveur garde le meilleur des plans. Combat
// du 2026-10-11 à 17:59 rejoué, 40 plans : recherche 1,16 s d'un seul tenant, 0,83 s en 3 fils, 0,75 s en 4, 0,66 s en
// 6, 0,91 s en 8 (les fils se gênent).
//
// Sondes : la demande attend dans les fils que le journal ait rattrapé le personnage (ATTENTE_SONDE_MS), au lieu de
// répondre « attendre » et d'être relancée à la sonde suivante : le calcul part dès que le journal est prêt.
import { appendFileSync } from 'node:fs'
import { cpus } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { characterOf, startReceiver } from '../../../scripts/fightlog-server.mjs'

export interface PlanServerOptions {
  port?: number
  logsDir?: string
  quiet?: boolean
}

/** Fils de calcul (au moins 1). */
const FILS = Math.max(1, Number(process.env.REINE_FILS ?? Math.min(6, Math.floor(cpus().length / 2))) || 1)
/** Attente du journal par une demande en sondes, dans les fils (ms) : un peu moins que l'attente du script avant sa demande « dernière » (6 s). */
const ATTENTE_SONDE_MS = 5500

/** Lignes du journal utiles au calcul (sans l'historique, les photos ni les types). */
const KEEP = new Set(['m', 'p'])
/** Liste des sorts du personnage (journal.ts, PROTO.spellList) : gardée même en ligne « h » d'historique. */
const SPELL_LIST = 'hkh'

function parseBody(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of text.split(/\r?\n/)) {
    const k = l.indexOf('=')
    if (k > 0) out[l.slice(0, k).trim()] = l.slice(k + 1).trim()
  }
  return out
}

/** Démarre le serveur (récepteur du journal + route /plan). Rend { server, close } (close arrête aussi le calcul). */
export function startPlanServer(opts: PlanServerOptions = {}) {
  const log = (text: string) => {
    if (!opts.quiet) process.stdout.write(`\n[plan ${new Date().toTimeString().slice(0, 8)}] ${text}\n`)
  }
  // Dossier des journaux (comme le récepteur) : le calcul y garde la dernière liste de sorts connue de chaque Crâ.
  const logsDir = opts.logsDir ?? process.env.FIGHTLOG_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'fightlogs')
  const workers = Array.from({ length: FILS }, (_, index) => {
    const w = new Worker(new URL('./serveur-calcul.ts', import.meta.url), { execArgv: ['--import', 'tsx'], workerData: { logsDir, part: { index, count: FILS } } })
    w.unref()
    return w
  })
  type Answer = { text: string; log?: string[]; record?: object }
  /** Demande en cours : destinataire (réponse HTTP ou tâche de sondes) et réponses déjà reçues des fils. */
  const pending = new Map<number, { to: ServerResponse | { who: string; sig: string }; answers: Answer[] }>()
  /**
   * Demandes par sondes (sonde=1) : le calcul tourne en arrière-plan, chaque sonde reçoit tout de suite « attendre » ou
   * le résultat. Aucune requête des scripts ne reste ouverte (2026-10-10 : tours clos par AnkaBot pendant de longues
   * requêtes). Par personnage : signature de la demande (manche, case, PA, PM, refus), état, réponse.
   */
  const jobs = new Map<string, { sig: string; done: boolean; text?: string; waiters: { res: ServerResponse; timer: NodeJS.Timeout }[]; id: number; forced?: boolean }>()
  /**
   * Sonde « longue » (longue=<ms>, 3 s au plus) : la réponse attend la fin du calcul au lieu de partir tout de suite
   * (« attendre », puis sonde suivante) — le plan part dès qu'il est prêt. Combat du 2026-10-11 à 21:48 : 0,49 s en
   * moyenne entre la fin du calcul et sa réception par le script (sondes toutes les 100 ms, requêtes d'AnkaBot).
   */
  const wait = (j: { waiters: { res: ServerResponse; timer: NodeJS.Timeout }[] }, res: ServerResponse, ms: number, text: string) => {
    const w = { res, timer: setTimeout(() => {
      j.waiters = j.waiters.filter(x => x !== w)
      reply(res, text)
    }, ms) }
    j.waiters.push(w)
  }
  const release = (j: { waiters: { res: ServerResponse; timer: NodeJS.Timeout }[] }, text: string) => {
    for (const w of j.waiters) {
      clearTimeout(w.timer)
      reply(w.res, text)
    }
    j.waiters = []
  }
  let nextId = 1
  let plansFile = ''
  const reply = (res: ServerResponse, text: string) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(text)
  }
  /**
   * Réponse commune des fils : « attendre » si l'un attend encore le journal (la sonde suivante relance) ; sinon le plan
   * de meilleure note ; sinon la première réponse (« aucun … »).
   */
  const combine = (answers: Answer[]): Answer => {
    const wait = answers.find(a => a.text.startsWith('attendre'))
    if (wait) return wait
    const plans = answers.filter(a => a.text.startsWith('plan '))
    if (!plans.length) return answers[0]
    const note = (a: Answer) => Number(a.text.split(/\s/)[1])
    return plans.reduce((best, a) => (note(a) > note(best) ? a : best))
  }
  const onAnswer = (m: { type: string; id: number } & Answer) => {
    if (m.type !== 'plan') return
    const p = pending.get(m.id)
    if (!p) return
    p.answers.push(m)
    if (p.answers.length < workers.length) return
    pending.delete(m.id)
    const best = combine(p.answers)
    for (const l of best.log ?? []) log(l)
    if (best.record && plansFile) appendFileSync(plansFile, JSON.stringify({ ...best.record, fils: workers.length }) + '\n')
    const res = p.to
    if ('who' in res) {
      const j = jobs.get(res.who)
      if (!j || j.sig !== res.sig) return
      // Pas encore synchronisé : la sonde suivante relance la vérification.
      if (best.text.startsWith('attendre')) {
        jobs.delete(res.who)
        release(j, best.text)
      } else if (j.waiters.length) {
        // (une sonde longue attend : elle emporte le plan)
        jobs.delete(res.who)
        release(j, best.text)
      } else Object.assign(j, { done: true, text: best.text })
      return
    }
    reply(res, best.text)
  }
  workers.forEach((w, k) => {
    w.on('message', onAnswer)
    w.on('error', err => log(`fil de calcul ${k + 1} arrêté : ${err.stack ?? err}`))
  })
  const ask = (msg: object) => {
    for (const w of workers) w.postMessage(msg)
  }

  const receiver = startReceiver({
    port: opts.port,
    logsDir: opts.logsDir,
    quiet: opts.quiet,
    // Plus la liste des sorts du personnage (ligne « h » d'historique : reçue à la connexion, avant le journal).
    onBatch: ({ header, lines }) => ask({ type: 'batch', header, lines: lines.filter(o => KEEP.has(o.k) || (o.k === 'h' && o.n === SPELL_LIST)) }),
    route: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/plan')) return false
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        const id = nextId++
        const who = characterOf(req.url ?? '')
        const q = parseBody(Buffer.concat(chunks).toString('utf8'))
        if (q.sonde !== '1') {
          pending.set(id, { to: res, answers: [] })
          ask({ type: 'plan', id, who, q })
          return
        }
        // (« dernière » hors signature : un calcul déjà lancé pour le même état continue au lieu d'être relancé ; 14:24, Java
        // manche 2 : plan prêt en 7,5 s mais jeté par la demande « dernière » de 6 s, recalculé, script parti à 14 s.
        // Manche dans la signature : un plan fini mais jamais lu, tour coupé, n'est pas servi au tour suivant sur la même
        // case avec les mêmes PA/PM — 18:41, Lowkey a joué en manches 8, 10 et 16 le plan de la manche d'avant.)
        const sig = [q.manche ?? '', q.case, q.pa, q.pm, q.refus ?? ''].join('|')
        const longue = Math.min(3000, Math.max(0, Number(q.longue) || 0))
        const j = jobs.get(who)
        if (j?.sig === sig) {
          // Demande « dernière » pendant que les fils attendent encore le journal : calcul tout de suite (23:48, Lamouit :
          // 11 s pour un plan de 33 ms, la demande « dernière » attendant la fin de l'attente précédente).
          if (!j.done && q.derniere === '1' && !j.forced) {
            j.forced = true
            ask({ type: 'force', id: j.id })
          }
          if (j.done) {
            jobs.delete(who)
            reply(res, j.text!)
          } else if (longue) wait(j, res, longue, 'attendre calcul en cours')
          else reply(res, 'attendre calcul en cours')
          return
        }
        // (ancienne demande, autre signature : ses sondes longues repartent, le script redemandera)
        if (j) release(j, 'attendre nouvelle demande')
        const job = { sig, done: false, waiters: [] as { res: ServerResponse; timer: NodeJS.Timeout }[], id }
        jobs.set(who, job)
        pending.set(id, { to: { who, sig }, answers: [] })
        // Dernière demande (attente écoulée) : plan quand même, journal en retard ou non.
        ask({ type: 'plan', id, who, q: { ...q, attente: q.derniere === '1' ? '0' : String(ATTENTE_SONDE_MS), sonde: q.derniere === '1' ? '0' : '1' } })
        if (longue) wait(job, res, longue, 'attendre demande transmise')
        else reply(res, 'attendre demande transmise')
      })
      return true
    },
    banner: [
      'Serveur de plans de la Reine des Voleurs : POST /plan (tools/ankabot/ReineIA.lua, à charger sur le chef du groupe).',
      `Calcul sur ${FILS} fil(s) (REINE_FILS). Laisser cette fenêtre ouverte pendant les combats. Ctrl+C pour arrêter.`,
    ],
  })
  plansFile = receiver.file.replace(/session-([^\\/]+)\.jsonl$/, 'plans-$1.jsonl')
  return {
    server: receiver.server,
    close: () => {
      receiver.server.close()
      for (const w of workers) void w.terminate()
    },
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('planificateur/serveur.ts')) startPlanServer()
