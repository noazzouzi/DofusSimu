/**
 * Theorycraft contre un boss — rendu texte (français, CLI) de la question (1) « quel stuff est le plus intéressant
 * contre ce boss ? » (`StuffVsBossResult`, src/theorycraft/stuff.ts ; docs/design/theorycraft.md §1.9).
 *
 * Sections : boss et personnage (style de jeu, `character.style`, et son explication quand il diffère de celui du
 * preset) ; tableau comparatif (départ, stuff du preset, génériques, puis optimisés : score de
 * classement — logJ du proxy ou logJ soutenu, `ranking` —, DPT soutenu, DPT du proxy, PV, PV effectifs, dégâts reçus,
 * PA/PM/PO, pénalité de l'objectif) ; meilleur stuff détaillé (posture, dégâts reçus par
 * élément, objets par emplacement avec forgemagie, points et parchemins, objets changés, DPT par sort) ; autres stuffs
 * du top (objets changés) ; comparaison des éléments (option `elements: 'all'`) ; équivalences des caractéristiques ;
 * hypothèses et avertissements ; statistiques de la recherche.
 *
 * Module PUR : ne lit que le résultat (aucune donnée du jeu, aucun import d'exécution) — réutilisable côté navigateur.
 */
import type { StuffEvaluation, StuffVsBossResult } from './types'

export interface FormatStuffOptions {
  /** Lignes d'équivalences affichées (défaut 12). */
  weights?: number
  /** Afficher les hypothèses (défaut vrai). */
  assumptions?: boolean
  /** Détail des autres stuffs du top (défaut vrai). */
  others?: boolean
}

const ELEMENTS_FR = ['Neutre', 'Terre', 'Feu', 'Eau', 'Air'] as const

/** Nombre à la française (espace fine insécable des milliers, virgule décimale). */
function num(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '—'
  return x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const signed = (x: number, digits: number) => `${x >= 0 ? '+' : '−'}${num(Math.abs(x), digits)}`

/** Tableau aligné (première colonne à gauche, les autres à droite). */
function table(header: string[], rows: string[][], indent = '  '): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const line = (r: string[]) => indent + r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd()
  return [line(header), ...rows.map(line)]
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

/** Score qui classe les stuffs du résultat (logJ du proxy, ou logJ soutenu : `ranking`). */
type Rank = (e: StuffEvaluation) => number | null

function row(e: StuffEvaluation, rank: Rank, startRank: number | null): string[] {
  const v = rank(e)
  const delta = v !== null && startRank !== null && e.origin !== 'start' && e.origin !== 'user' ? ` (${signed(v - startRank, 3)})` : ''
  return [
    shorten(e.label, 60) + (e.valid ? '' : ' [invalide]'),
    v === null ? '—' : `${num(v, 3)}${delta}`,
    num(e.damage.steady),
    num(e.damage.proxy),
    num(e.survival.hp),
    num(e.survival.ehp) + (e.survival.capped ? '*' : ''),
    num(e.survival.incoming),
    `${e.ap}/${e.mp}/${e.range}`,
    e.penalty < 1 - 1e-9 ? `×${num(e.penalty, 3)}` : '—',
  ]
}

/** Dégâts reçus par élément (« Terre 621, Eau 808 »). */
function incomingText(e: StuffEvaluation): string {
  const parts = e.survival.incomingByElement.map((v, i) => (v >= 0.5 ? `${ELEMENTS_FR[i]} ${num(v)}` : '')).filter(Boolean)
  if (e.survival.incomingOther >= 0.5) parts.push(`hors élément ${num(e.survival.incomingOther)}`)
  return parts.length ? parts.join(', ') : 'aucun'
}

function pointsText(p: Partial<Record<string, number>>): string {
  const names: Record<string, string> = { vitality: 'Vitalité', wisdom: 'Sagesse', strength: 'Force', intelligence: 'Intelligence', chance: 'Chance', agility: 'Agilité' }
  const parts = Object.entries(p)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${names[k] ?? k} ${num(v ?? 0)}`)
  return parts.length ? parts.join(', ') : 'aucun'
}

function changesText(e: StuffEvaluation): string {
  const { added, removed } = e.changes
  if (!added.length && !removed.length) return 'aucun objet changé'
  const a = added.map(i => i.name).join(', ')
  const r = removed.map(i => i.name).join(', ')
  return [a && `+ ${a}`, r && `− ${r}`].filter(Boolean).join(' ; ')
}

/** Rendu texte complet (voir l'en-tête). */
export function formatStuffVsBoss(r: StuffVsBossResult, opts: FormatStuffOptions = {}): string {
  const out: string[] = []
  const b = r.boss
  const c = r.character
  const weakest = b.weakestElements.length ? ELEMENTS_FR[b.weakestElements[0]] : '—'
  out.push(`Stuff contre ${b.name} (${b.monsterId}) — grade ${b.grade}${b.players !== undefined ? ` (${b.players} joueurs)` : ''}, niveau ${b.level}, ${num(b.hp)} PV`)
  const reductions = [b.rangedResPct ? `distance ${num(b.rangedResPct)} %` : '', b.meleeResPct ? `mêlée ${num(b.meleeResPct)} %` : ''].filter(Boolean)
  out.push(`  Résistances effectives : ${b.resPct.map((v, i) => `${ELEMENTS_FR[i]} ${num(v)} %`).join(' · ')} (plus faible : ${weakest})${reductions.length ? ` ; réduction ${reductions.join(', ')}` : ''}`)
  if (b.mechanics.length) out.push(`  Mécaniques : ${b.mechanics.join(' ; ')}`)
  out.push(
    `  Personnage : ${c.className} niveau ${c.level}, preset ${c.presetId} (${c.presetLabel}), rôle ${c.roleLabel}, élément ${c.elementLabel}, ${c.style.label}${c.input !== 'preset' ? ` — stuff fourni (${c.input === 'roxx' ? 'lien RoxxSolver' : 'build'})` : ''}`,
  )
  // Style différent de celui du preset (Crâ contre Merkator : joué au contact) : pourquoi, et ce qui en dépend.
  if (c.style.reason) out.push(`  Jeu : joué ${c.style.label} : ${c.style.reason} — ${r.options.rangeNeed > 0 ? `${r.options.rangeNeed} PO visées` : 'PO non exigée'}${c.style.contact ? ', % dommages mêlée valorisés' : ''}.`)
  out.push('  Les classements valent plus que les valeurs absolues (voir les hypothèses).')
  out.push('')

  // ── Tableau comparatif ──
  const sustained = r.ranking.by === 'sustained'
  const rank: Rank = e => (sustained ? e.logJSustained : e.logJ)
  const scoreName = sustained ? 'logJ soutenu' : 'logJ'
  const startRank = rank(r.start)
  out.push('Comparaison')
  const header = ['Stuff', `${scoreName} (écart au départ)`, 'DPT soutenu', 'DPT proxy', 'PV', 'PVe', 'Reçus/tour', 'PA/PM/PO', 'Pénalité']
  const rows = [...r.comparison.map(e => row(e, rank, startRank)), ...r.top.filter(e => e.origin === 'optimized').map(e => row(e, rank, startRank))]
  out.push(...table(header, rows))
  out.push(`  ${r.ranking.reason}`)
  out.push('  DPT soutenu : rotation établie (relances amorties), meilleure posture, non calibré. DPT proxy : objectif de l’optimiseur (un tour, × calibration du preset, sans posture).')
  out.push('  PVe : PV effectifs (PV × dégâts reçus sans défense / avec défenses)' + (rows.some(x => x[5].endsWith('*')) ? ' ; * = plafond de 20 × PV atteint.' : '.'))
  out.push(
    `  Pénalité : facteur de l’objectif pour PA/PM/PO sous les valeurs visées (12 PA, 6 PM, ${r.options.rangeNeed > 0 ? `${r.options.rangeNeed} PO` : 'PO non exigée'} ; ×0,85, ×0,9, ×0,95 par point manquant), compris dans ${scoreName} — un réglage, pas un effet du boss.`,
  )
  if (!r.startValid) out.push('  Le stuff de départ est invalide : il n’est jamais retenu comme meilleur.')
  out.push('')

  // ── Meilleur stuff ──
  const best = r.best
  const bestRank = rank(best)
  const gain = bestRank !== null && startRank !== null && best !== r.start && best.id !== r.start.id ? ` (${signed(bestRank - startRank, 3)} par rapport au départ)` : ''
  out.push(`Meilleur stuff : ${best.label} — ${scoreName} ${bestRank === null ? '—' : num(bestRank, 3)}${gain}`)
  const d = best.damage
  out.push(
    `  DPT soutenu ${num(d.steady)} (rafale ${num(d.burst)}, période ${d.period || '?'} tour${d.period > 1 ? 's' : ''}, posture « ${d.stance.name} ») ; DPT proxy ${num(d.proxy)}`,
  )
  out.push(`  PV ${num(best.survival.hp)}, PVe ${num(best.survival.ehp)}${best.survival.capped ? ' (plafond)' : ''}, dégâts reçus ${num(best.survival.incoming)}/tour (${incomingText(best)})`)
  out.push(`  ${best.ap} PA, ${best.mp} PM, ${best.range} PO${best.util > 0 ? ` ; utilité du rôle ${num(best.util, 2)}` : ''}${best.penalty < 1 ? ` ; pénalité ×${num(best.penalty, 3)}` : ''}`)
  out.push('  Objets :')
  for (const it of best.items) {
    const forge = it.forge.length ? ` [${it.forge.join(', ')}]` : ''
    out.push(`    ${it.slotLabel.padEnd(20)} ${it.name} (niv. ${it.level})${forge}${it.passive ? ' — sort passif non valorisé' : ''}`)
  }
  out.push(`  Points : ${pointsText(best.points)}${best.pointsId && best.pointsId !== 'start' ? ` (répartition « ${best.pointsId} »)` : ''} ; parchemins : ${pointsText(best.scrolls)}`)
  out.push(`  Objets changés par rapport au départ : ${changesText(best)}`)
  if (d.spells.length) {
    out.push('  DPT soutenu par sort (lancers/tour × dégâts par lancer) :')
    out.push(
      ...table(
        ['Sort', 'PA', 'Lancers/tour', 'Dégâts/lancer', 'Dégâts/tour', 'Part'],
        d.spells.map(s => [s.name, num(s.apCost), num(s.castsPerTurn, 2), num(s.damagePerCast), num(s.damagePerTurn), `${num(s.share * 100)} %`]),
        '    ',
      ),
    )
  } else out.push('  Aucun sort ne fait de dégâts à ce boss dans ce modèle.')
  out.push('')

  // ── Autres stuffs du top ──
  if (opts.others ?? true) {
    const others = r.top.filter(e => e !== best && e.id !== best.id)
    if (others.length) {
      out.push('Autres stuffs du top (objets changés par rapport au départ)')
      for (const e of others) {
        const v = rank(e)
        out.push(`  ${e.label} — ${scoreName} ${v === null ? '—' : num(v, 3)}, DPT soutenu ${num(e.damage.steady)}, PVe ${num(e.survival.ehp)} : ${changesText(e)}`)
      }
      out.push('')
    }
  }

  // ── Éléments ──
  if (r.elements?.length) {
    out.push('Comparaison des éléments (une recherche par élément)')
    out.push(
      ...table(
        ['Élément', 'Rés. du boss', scoreName, 'DPT soutenu', 'PVe', ''],
        r.elements.map(e => {
          const v = rank(e.best)
          return [e.label, `${num(e.bossResPct)} %`, v === null ? '—' : num(v, 3), num(e.best.damage.steady), num(e.best.survival.ehp), e.chosen ? '← retenu' : '']
        }),
      ),
    )
    out.push('')
  }

  // ── Équivalences ──
  const w = r.statWeights
  out.push(`Équivalences des caractéristiques contre ce boss (référence : ${w.referenceLabel})`)
  const max = opts.weights ?? 12
  for (const e of w.items.slice(0, max)) out.push(`  ${e.text}${e.perRuneWeight !== null ? ` — par poids de rune : ×${num(e.perRuneWeight, 2)}` : ''}`)
  if (w.items.length > max) out.push(`  … ${w.items.length - max} autres caractéristiques (sortie JSON).`)
  for (const n of w.notes) out.push(`  (${n})`)
  out.push('')

  // ── Hypothèses et avertissements ──
  if (opts.assumptions ?? true) {
    out.push('Hypothèses')
    for (const a of r.assumptions) out.push(`  - ${a}`)
    out.push('')
  }
  if (r.warnings.length) {
    out.push('Avertissements')
    for (const x of r.warnings) out.push(`  ! ${x}`)
    out.push('')
  }

  const s = r.search
  out.push(
    `Recherche : ${s.runs} recherche(s) de ${num(r.options.iterations)} itérations, ${num(s.ms / 1000, 1)} s, ${num(s.evaluations.surrogate)} évaluations (forme fermée) + ${num(s.evaluations.exact)} exactes ; viviers ${num(s.pools.kept)} objets ; graines : ${s.seedStuffs.length ? s.seedStuffs.join(', ') : 'départ et glouton seulement'}.`,
  )
  return out.join('\n')
}
