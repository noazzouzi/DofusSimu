/**
 * Theorycraft contre un boss — rendu TEXTE français du classement des classes pour la CLI (docs/design/theorycraft.md
 * §1.8-1.9) : un tableau par axe (Dégâts, Survie, Contrôle, Soin, Apport d'équipe ; une ligne par classe, son meilleur
 * preset), le meilleur preset de chaque classe par axe, la composition suggérée avec ses règles, atouts et limites des
 * membres, hypothèses et avertissements. Aucune note globale : chaque axe est montré avec son unité. Rang partagé des ex
 * æquo marqué « = » (Survie : PV effectifs du stuff seul, identiques par stuff générique). Colonnes de contrôle : facteur
 * d'étalonnage du preset (indicatif : il ne s'applique pas au DPT soutenu), retraits du tour mixte et des tours
 * consacrés, débit de soin brut et plafond. Tableaux alignés en largeur fixe, sans émoji.
 *
 * Module PUR (types et mise en forme seulement) : utilisable côté navigateur.
 */
import { bullets, ELEMENT_LABELS, fmtNum, fmtPct, section, textTable } from './formatBoss'
import type { ClassRanking, PresetEvaluation, RankingAxis } from './types'

export interface FormatClassesOptions {
  /** Lignes par tableau d'axe (défaut : toutes les classes). */
  top?: number
  /** Ajouter le tableau de tous les presets évalués (défaut faux). */
  presets?: boolean
}

const AXIS_ORDER: readonly RankingAxis[] = ['damage', 'survival', 'control', 'heal', 'team']

/** Détail affiché à côté de la valeur d'un axe pour un preset. */
function axisDetail(axis: RankingAxis, e: PresetEvaluation): string[] {
  switch (axis) {
    case 'damage':
      return [
        calibrationText(e),
        fmtNum(e.dpt.burst),
        `${ELEMENT_LABELS[e.elementMatch.element] ?? '?'} (${fmtPct(e.elementMatch.resPct)})`,
        e.stance.id === 'base' ? '—' : e.stance.name,
      ]
    case 'survival':
      return [fmtNum(e.survival.hp), fmtNum(e.survival.incoming), e.survival.turnsToDie > 0 ? fmtNum(e.survival.turnsToDie, 1) : '—']
    case 'control':
      return [fmtNum(e.control.combined.mp, 2), fmtNum(e.control.combined.ap, 2), fmtNum(e.control.mpRemoved, 2), fmtNum(e.control.apRemoved, 2)]
    case 'heal':
      return [fmtNum(e.heal.raw), fmtNum(e.heal.mixed.heal), fmtNum(e.heal.mixed.shield), fmtPct(e.heal.reduction), fmtNum(e.heal.armor)]
    case 'team':
      return [e.team.parts.map(p => `${p.label} ${fmtNum(p.pct, 1)}`).join(', ') || '—']
  }
}

const DETAIL_HEADERS: Readonly<Record<RankingAxis, string[]>> = {
  damage: ['Étal. preset', 'Rafale', 'Élément (rés.)', 'Posture'],
  survival: ['PV', 'Reçus/tour', 'Tours'],
  control: ['PM', 'PA', 'PM seul', 'PA seul'],
  heal: ['Brut', 'Soin', 'Bouclier', 'Réduction', 'Armure'],
  team: ['Décomposition (%)'],
}

const DETAIL_ALIGN: Readonly<Record<RankingAxis, string>> = {
  damage: 'rrll',
  survival: 'rrr',
  control: 'rrrr',
  heal: 'rrrrr',
  team: 'l',
}

/** Notes sous le titre d'un axe (lecture des colonnes). */
function axisNote(axis: RankingAxis, r: ClassRanking): string | undefined {
  switch (axis) {
    case 'damage':
      return '  Valeur : DPT soutenu analytique (classement) ; « Étal. preset » = facteur d\'étalonnage du preset (data/ai/calibration.json : moteur / sac à dos joué dans le moteur, contre un Buboxor) — indicatif, il ne s\'applique pas au DPT soutenu.'
    case 'survival':
      return '  Stuff seul : même valeur pour les presets d\'un même stuff générique (rang partagé « = »).'
    case 'control':
      return '  Valeur : PM + PA en UN tour (un budget de PA) ; « PM seul » / « PA seul » : tour entier consacré à une réserve (non additionnables).'
    case 'heal': {
      const cap = r.presets[0]?.heal.cap
      return `  Valeur : PV utiles = min(brut, ${cap !== undefined ? fmtNum(cap) : '?'}) (dégâts d'un tour du boss sur un personnage) ; soin et bouclier du tour mixte (un budget de PA), boucliers supposés consommés.`
    }
    default:
      return undefined
  }
}

/** Facteur d'étalonnage du preset (« ×0,73 ») : indicatif, jamais multiplié au DPT soutenu. */
function calibrationText(e: PresetEvaluation): string {
  return `×${fmtNum(e.dpt.calibration, 2)}`
}

const valueText = (axis: RankingAxis, v: number) => (axis === 'control' ? fmtNum(v, 2) : axis === 'team' ? fmtNum(v, 1) : fmtNum(v))

/** Classement texte (voir l'en-tête). */
export function formatClasses(r: ClassRanking, opts: FormatClassesOptions = {}): string {
  const out: string[] = []
  const byId = new Map(r.presets.map(e => [e.presetId, e]))
  const stuff = r.stuff === 'optimized' ? 'stuffs optimisés contre le boss' : r.level < 200 ? 'sans équipement' : 'stuffs génériques des presets'
  out.push(section(`Classes contre ${r.boss.name} (${r.boss.monsterId}) — grade ${r.boss.grade}, ${r.players} joueur(s), niveau ${r.level}, ${stuff}`))
  out.push('  Aucune note globale : chaque axe est classé à part. Les classements valent plus que les valeurs absolues.')

  // Résistances ≥ 100 % sans fiche manuelle : colonne du DPT si la mécanique les lève (repli de la composition).
  const lifted = r.presets.some(e => e.dpt.resLifted !== undefined)
  for (const axis of AXIS_ORDER) {
    const a = r.axes.find(x => x.axis === axis)
    if (!a) continue
    const entries = opts.top ? a.entries.slice(0, opts.top) : a.entries
    const extra = axis === 'damage' && lifted
    out.push('', `${a.label} (${a.unit})`)
    const note = axisNote(axis, r)
    if (note) out.push(note)
    out.push(
      textTable(
        ['#', 'Classe', 'Preset', 'Valeur', ...DETAIL_HEADERS[axis], ...(extra ? ['Rés. levées'] : []), 'Confiance'],
        entries.map(x => {
          const e = byId.get(x.presetId)!
          return [`${x.tied ? '=' : ''}${x.rank}`, x.className, x.presetId, valueText(axis, x.value), ...axisDetail(axis, e), ...(extra ? [fmtNum(e.dpt.resLifted ?? 0)] : []), e.confidence.level]
        }),
        `rllr${DETAIL_ALIGN[axis]}${extra ? 'r' : ''}l`,
      ),
    )
  }

  out.push('', 'Par classe : meilleure valeur sur chaque axe (preset : voir les tableaux par axe)')
  out.push(
    textTable(
      ['Classe', ...AXIS_ORDER.map(ax => r.axes.find(x => x.axis === ax)?.label ?? ax), 'Confiance (classe)'],
      [...r.classes].sort((a, b) => a.className.localeCompare(b.className)).map(c => [c.className, ...AXIS_ORDER.map(ax => valueText(ax, c.best[ax].value)), c.confidence]),
      'lrrrrrl',
    ),
  )

  if (opts.presets) {
    out.push('', 'Tous les presets évalués')
    out.push(
      textTable(
        ['Preset', 'Stuff', 'Posture', 'DPT', 'Étal. preset', 'Rafale', 'PV eff.', 'Contrôle', 'Soin', 'Apport %', 'Confiance'],
        [...r.presets]
          .sort((a, b) => b.axes.damage - a.axes.damage || a.presetId.localeCompare(b.presetId))
          .map(e => [
            e.presetId,
            e.stuff,
            e.stance.id === 'base' ? '—' : e.stance.name,
            fmtNum(e.dpt.steady),
            calibrationText(e),
            fmtNum(e.dpt.burst),
            fmtNum(e.survival.ehp),
            fmtNum(e.control.value, 2),
            fmtNum(e.heal.value),
            fmtNum(e.team.gainPct, 1),
            e.confidence.level,
          ]),
        'lllrrrrrrrl',
      ),
    )
  }

  out.push('', `Composition suggérée (${r.players} personnage(s))`)
  out.push(textTable(['Rôle', 'Classe', 'Preset', 'Raison'], r.composition.members.map(m => [m.slot, m.className, m.presetId, m.reason]), 'llll'))
  if (r.composition.notes.length) out.push('  Notes :', bullets(r.composition.notes, '    '))
  out.push('  Règles :', bullets(r.composition.rules, '    '))

  out.push('', 'Atouts et limites des membres proposés')
  for (const m of r.composition.members) {
    const e = byId.get(m.presetId)
    if (!e) continue
    out.push(`  ${m.className} (${m.presetId}) — confiance ${e.confidence.level}`)
    out.push(`    Atouts : ${e.relevance.atouts.length ? e.relevance.atouts.join(' ') : 'aucun atout particulier contre ce boss.'}`)
    out.push(`    Limites : ${e.relevance.limites.length ? e.relevance.limites.join(' ') : 'aucune limite particulière détectée.'}`)
    if (e.confidence.reasons.length) out.push(`    Non modélisé : ${e.confidence.reasons.join(' ')}`)
  }

  out.push('', 'Hypothèses', bullets(r.assumptions))
  out.push('', 'Avertissements', bullets(r.warnings))
  return out.join('\n')
}
