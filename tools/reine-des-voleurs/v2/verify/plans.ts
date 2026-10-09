import type { Plan, Variant, Timing } from './sim.ts'

const n4ts = (v: Variant, t: Timing) => (v === 'C' || v === 'D' || v === 'E' || v === 'E2') && t === 'TS'

export const FA: Plan = {
  name: 'F-A',
  start: [365, 378, 437, 451],
  home: [311, 392, 398, 479],
  alt: [325, 406, 412, 493],
  useAlt: n4ts,
}
export const FC: Plan = {
  name: 'F-C',
  start: [365, 437, 378, 451],
  home: [297, 370, 392, 464],
  alt: [312, 384, 406, 479],
  useAlt: n4ts,
}
export const FB: Plan = {
  name: 'F-B',
  start: [340, 367, 365, 437],
  home: [270, 381, 392, 425],
}
// Variante « plus robuste » citée dans la règle de décision (départs 365/378/437/451 → 339/406/426/493) : affectation
// non précisée par le chercheur ; on teste toutes les affectations à ≤ 5 PM dans verif.ts.
export const OLD: Plan = {
  name: 'ancien README',
  start: [354, 381, 380, 451],
  home: [354, 381, 408, 435],
}
export const PLANS = [FA, FC, FB]
