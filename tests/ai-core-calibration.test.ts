/**
 * Calibration du DPT (docs/design/ai.md §6.4) : `data/ai/calibration.json` est-il à jour avec le moteur et les
 * données ? Recalcule le rapport « dégâts simulés / DPT analytique » (src/ai/core/calibrate.ts) pour chaque preset
 * (data/ai/presets.json, stuffs réels) et chaque classe (build THL simulé des tests, repli « breed ») et le compare
 * aux valeurs stockées (dérive ≤ 0,03).
 *
 * Régénération du fichier (après une évolution du moteur, des données ou des presets) :
 *   WRITE_CALIBRATION=1 npx vitest run tests/ai-core-calibration.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CALIBRATION_BOUNDS, measureCalibration, type CalibrationTable } from '../src/ai/core'
import { buildTeam } from '../src/optimizer/runner'
import { PRESETS, presetMember } from '../src/optimizer/team/presets'
import { data, engineFor, mapOf, player, THL, VORTEX_MAP } from './ai-core-helpers'

const FILE = 'data/ai/calibration.json'
const DRIFT = 0.03

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

describe('calibration du DPT (data/ai/calibration.json)', () => {
  it('presets et classes : valeurs stockées = mesure actuelle (± 0,03), bornées', () => {
    const engine = engineFor()
    const map = mapOf(VORTEX_MAP)
    const presets: Record<string, number> = {}
    const breeds: Record<string, number> = {}
    const lines: string[] = []
    for (const preset of PRESETS) {
      const [f] = buildTeam(data, [presetMember(preset, data)])
      const m = measureCalibration(engine, f, { map })
      presets[preset.id] = round3(m.ratio)
      if (Math.abs(m.ratio - 1) > 0.05) lines.push(`preset ${preset.id} : ${m.ratio.toFixed(3)} (analytique ${Math.round(m.analytic)}, simulé ${Math.round(m.simulated)}, ${m.casts} lancers)`)
    }
    for (const b of data.listBreeds()) {
      const m = measureCalibration(engine, player(b.id, { extra: THL }), { map })
      breeds[String(b.id)] = round3(m.ratio)
      if (Math.abs(m.ratio - 1) > 0.05) lines.push(`classe ${b.id} ${b.name} : ${m.ratio.toFixed(3)} (analytique ${Math.round(m.analytic)}, simulé ${Math.round(m.simulated)})`)
    }
    console.log(`calibration : ${Object.keys(presets).length} presets, ${Object.keys(breeds).length} classes ; écarts > 5 % :\n${lines.join('\n')}`)
    for (const v of [...Object.values(presets), ...Object.values(breeds)]) {
      expect(v).toBeGreaterThanOrEqual(CALIBRATION_BOUNDS[0])
      expect(v).toBeLessThanOrEqual(CALIBRATION_BOUNDS[1])
    }
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as CalibrationTable & { _meta: unknown }
    if (process.env.WRITE_CALIBRATION) {
      const out = { _meta: stored._meta, default: 1, presets, breeds, monsters: stored.monsters ?? {} }
      writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`)
      return
    }
    // Preset ajouté depuis la dernière mesure : simple avertissement (le facteur par défaut 1 s'applique) ; régénérer.
    const missing = Object.keys(presets).filter(k => stored.presets[k] === undefined)
    if (missing.length) console.warn(`calibration : presets non mesurés (WRITE_CALIBRATION=1 pour régénérer) : ${missing.join(', ')}`)
    for (const [k, v] of Object.entries(presets)) if (stored.presets[k] !== undefined) expect(Math.abs(stored.presets[k] - v), `preset ${k}`).toBeLessThanOrEqual(DRIFT)
    for (const [k, v] of Object.entries(breeds)) if (stored.breeds[k] !== undefined) expect(Math.abs(stored.breeds[k] - v), `classe ${k}`).toBeLessThanOrEqual(DRIFT)
  }, 120_000)
})
