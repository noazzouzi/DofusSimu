import { describe, expect, it } from 'vitest'
import { emptyStats, type TeamId } from '../src/core/types'
import type { Fighter, FighterKind } from '../src/engine/types'
import {
  casterPassesMask,
  compileTargetMask,
  isFamily,
  isHumanType,
  isStaticFighter,
  isSummoned,
  matchesTargetMask,
  parseTargetMask,
  type MaskContext,
} from '../src/engine/targetMask'

function fighter(id: number, team: TeamId, kind: FighterKind, extra: Partial<Fighter> = {}): Fighter {
  return {
    id,
    team,
    kind,
    name: `f${id}`,
    level: 200,
    baseStats: emptyStats(),
    stats: { ...emptyStats(), summons: 1 },
    hp: 1000,
    maxHp: 1000,
    baseMaxHp: 1000,
    shield: 0,
    ap: 6,
    mp: 3,
    cell: 0,
    alive: true,
    states: [],
    buffs: [],
    spells: [],
    cooldowns: {},
    castsThisTurn: {},
    castsOnTarget: {},
    ai: '',
    direction: 1,
    tags: {},
    ...extra,
  }
}

// Équipe 0 (lanceur) : Iop lanceur, Féca allié, invocation du lanceur, bombe statique, double, compagnon.
const caster = fighter(0, 0, 'player', { breedId: 8 })
const allyPlayer = fighter(1, 0, 'player', { breedId: 1 })
const allySummon = fighter(2, 0, 'summon', { monsterId: 3112, summonerId: 0 })
const allyStatic = fighter(3, 0, 'summon', { monsterId: 3113, summonerId: 0, tags: { static: true } })
const allyDouble = fighter(8, 0, 'summon', { breedId: 4, summonerId: 1 })
const allySidekick = fighter(9, 0, 'player', { monsterId: 77, tags: { sidekick: true } })
// Équipe 1 : Vortex, Auroraire (invocation du Vortex), invocation statique, joueur Crâ ennemi.
const enemyMonster = fighter(4, 1, 'monster', { monsterId: 3835 })
const enemySummon = fighter(5, 1, 'summon', { monsterId: 3833, summonerId: 4 })
const enemyStatic = fighter(6, 1, 'summon', { monsterId: 3851, summonerId: 4, tags: { canPlay: false } })
const enemyPlayer = fighter(7, 1, 'player', { breedId: 9 })

const everyone = [caster, allyPlayer, allySummon, allyStatic, allyDouble, allySidekick, enemyMonster, enemySummon, enemyStatic, enemyPlayer]
/** Ids sélectionnés par un masque. */
const sel = (mask: string, ctx?: MaskContext, from = caster) =>
  everyone.filter(t => matchesTargetMask(mask, from, t, ctx)).map(t => t.id)

describe('masques : classification des combattants', () => {
  it('invocation, statique, type humain, famille', () => {
    expect(isSummoned(allySummon)).toBe(true)
    expect(isSummoned(caster)).toBe(false)
    expect(isStaticFighter(allyStatic)).toBe(true)
    expect(isStaticFighter(enemyStatic)).toBe(true) // canPlay: false
    expect(isStaticFighter(enemySummon)).toBe(false)
    expect(isHumanType(caster)).toBe(true)
    expect(isHumanType(allyDouble)).toBe(true) // copie de joueur : type humain
    expect(isHumanType(allySidekick)).toBe(false)
    expect(isHumanType(enemyMonster)).toBe(false)
    expect(isFamily(caster, caster)).toBe(true)
    expect(isFamily(caster, allySummon)).toBe(true)
    expect(isFamily(allySummon, allyStatic)).toBe(true) // même invocateur
    expect(isFamily(allySummon, caster)).toBe(true) // son invocateur
    expect(isFamily(caster, allyDouble)).toBe(false) // invoqué par un autre allié
    expect(isFamily(caster, enemySummon)).toBe(false)
  })
})

describe('masques : inclusion (IsIncludedByMask)', () => {
  it('a / g / A / c / C et masque vide', () => {
    expect(sel('a')).toEqual([0, 1, 2, 3, 8, 9])
    expect(sel('g')).toEqual([1, 2, 3, 8, 9])
    expect(sel('A')).toEqual([4, 5, 6, 7])
    expect(sel('a,A')).toEqual(everyone.map(f => f.id))
    expect(sel('g,A')).toEqual([1, 2, 3, 8, 9, 4, 5, 6, 7])
    expect(sel('c')).toEqual([0])
    expect(sel('C')).toEqual([0])
    expect(sel('')).toEqual(everyone.map(f => f.id)) // masque vide : tout le monde (port)
  })

  it('lettres de type : le lanceur n’est jamais inclus par une lettre de type', () => {
    expect(sel('h')).toEqual([1])
    expect(sel('H')).toEqual([7])
    expect(sel('l')).toEqual([1, 9])
    expect(sel('L')).toEqual([7])
    expect(sel('d')).toEqual([9])
    expect(sel('D')).toEqual([])
    expect(sel('m')).toEqual([])
    expect(sel('M')).toEqual([4])
    expect(sel('i')).toEqual([2, 8])
    expect(sel('I')).toEqual([5])
    expect(sel('j')).toEqual([2, 3, 8])
    expect(sel('J')).toEqual([5, 6])
    expect(sel('s')).toEqual([3])
    expect(sel('S')).toEqual([6])
    expect(sel('x')).toEqual([])
    // Tout sauf les invocations (Accrocs du Roquet).
    expect(sel('m,M,l,L')).toEqual([1, 9, 4, 7])
    expect(sel('h,c')).toEqual([0, 1])
  })
})

describe('masques : conditions (PassMaskExclusion)', () => {
  it('E / e sur la cible, *E / *e sur le lanceur', () => {
    const stunned = fighter(10, 1, 'monster', { monsterId: 1, states: [516] })
    expect(matchesTargetMask('A,E516', caster, stunned)).toBe(true)
    expect(matchesTargetMask('A,E516', caster, enemyMonster)).toBe(false)
    expect(matchesTargetMask('A,e516', caster, stunned)).toBe(false)
    const drunk = fighter(11, 0, 'player', { breedId: 12, states: [3531] })
    expect(matchesTargetMask('C,*E3531', drunk, drunk)).toBe(true)
    expect(matchesTargetMask('C,*E3531', caster, caster)).toBe(false)
    expect(matchesTargetMask('a,A,*e7', caster, enemyMonster)).toBe(true)
    expect(casterPassesMask('a,A,*e7', caster)).toBe(true)
    expect(casterPassesMask('a,A,*E7', caster)).toBe(false)
    expect(casterPassesMask('A', caster)).toBe(true)
  })

  it('F / f (monstre), B / b (classe), groupes OU', () => {
    expect(sel('a,A,F3833')).toEqual([5])
    expect(sel('a,P,F3112,F3113,F3114')).toEqual([2, 3]) // une bombe du lanceur
    expect(sel('a,P,F3114,F5161')).toEqual([])
    expect(sel('a,A,f3835')).toEqual([0, 1, 2, 3, 8, 9, 5, 6, 7])
    expect(sel('a,B1')).toEqual([1])
    expect(sel('g,b1')).toEqual([2, 3, 8, 9])
    expect(sel('a,A,B1,B9')).toEqual([1, 7])
    expect(sel('a,B4')).toEqual([8]) // double d'un Sram : type humain de classe 4
    // F d'un humain : jamais (même si l'id coïncide).
    expect(matchesTargetMask('a,F8', caster, caster)).toBe(false)
    // Deux groupes OU distincts (F et B) : chacun doit être satisfait.
    expect(sel('a,A,F3112,F3835,B8,B9')).toEqual([])
    // Groupes OU du lanceur (*F) et de la cible (F) : évalués séparément, l'ordre des jetons est indifférent.
    const lance = fighter(20, 0, 'summon', { monsterId: 7139, summonerId: 0 })
    expect(matchesTargetMask('a,A,*F1,F3833,*F7139,F3835', lance, enemySummon)).toBe(true)
    expect(matchesTargetMask('a,A,*F1,F3833,*F7139,F3835', lance, enemyPlayer)).toBe(false)
    expect(matchesTargetMask('a,A,*F1,F3833,*F2,F3835', lance, enemySummon)).toBe(false)
    // Réentrance : un rappel du contexte peut évaluer un autre masque à groupes OU pendant l'évaluation.
    const ctx: MaskContext = { custom: (_code, f) => matchesTargetMask('a,A,B1,B9', caster, f) }
    expect(matchesTargetMask('a,A,B9,PR,B1', caster, enemyPlayer, ctx)).toBe(true)
    expect(matchesTargetMask('a,A,F3833,PR,F3835', caster, enemySummon, ctx)).toBe(false)
  })

  it('*F (groupe OU sur le lanceur), *h / *i / *m / *j / *l / *s (type du lanceur)', () => {
    expect(matchesTargetMask('C,*F7139', fighter(20, 0, 'summon', { monsterId: 7139, summonerId: 0 }), caster)).toBe(false)
    const lance = fighter(20, 0, 'summon', { monsterId: 7139, summonerId: 0 })
    expect(matchesTargetMask('C,*F7139', lance, lance)).toBe(true)
    expect(casterPassesMask('a,A,*e7,*F5836,*F5832,*F7139', lance)).toBe(true)
    expect(casterPassesMask('a,A,*F5836,*F5832', lance)).toBe(false)
    expect(casterPassesMask('A,*h', caster)).toBe(true)
    expect(casterPassesMask('A,*h', allySummon)).toBe(false)
    expect(casterPassesMask('C,*i', allySummon)).toBe(true)
    expect(casterPassesMask('C,*i', caster)).toBe(false)
    expect(casterPassesMask('C,*j', allyStatic)).toBe(true)
    expect(casterPassesMask('C,*s', allyStatic)).toBe(true)
    expect(casterPassesMask('C,*m', enemyMonster)).toBe(true)
    expect(casterPassesMask('C,*m', enemySummon)).toBe(false)
    expect(casterPassesMask('C,*l', caster)).toBe(true)
    expect(casterPassesMask('C,*d', allySidekick)).toBe(true)
    expect(casterPassesMask('C,*A', caster)).toBe(false)
  })

  it('P / p (famille), K (porté), O / o (déclencheur)', () => {
    expect(sel('a,P')).toEqual([0, 2, 3])
    expect(sel('g,p')).toEqual([1, 8, 9])
    expect(sel('h,P')).toEqual([])
    const carried = fighter(12, 1, 'monster', { monsterId: 1, carriedBy: 0 })
    expect(matchesTargetMask('g,K', caster, carried)).toBe(false) // ennemi : pas inclus par g
    expect(matchesTargetMask('a,A,K', caster, carried)).toBe(true)
    expect(matchesTargetMask('a,A,K', caster, enemyMonster)).toBe(false)
    expect(sel('A,O', { triggering: enemySummon })).toEqual([5])
    expect(sel('A,O')).toEqual([])
    expect(sel('A,o', { triggering: enemyMonster })).toEqual([4])
  })

  it('T / W (téléportations), U / u (apparition)', () => {
    const tele = fighter(13, 1, 'monster', { monsterId: 1, tags: { telefragged: true } })
    expect(matchesTargetMask('a,A,T', caster, tele)).toBe(true)
    expect(matchesTargetMask('a,A,T', caster, enemyMonster)).toBe(false)
    expect(matchesTargetMask('a,A,T', caster, enemyMonster, { wasTelefragged: f => f.id === 4 })).toBe(true)
    expect(matchesTargetMask('A,W', caster, enemyMonster, { wasTeleportedInvalid: () => true })).toBe(true)
    expect(matchesTargetMask('A,W', caster, fighter(14, 1, 'monster', { tags: { teleportedInvalid: true } }))).toBe(true)
    expect(sel('a,U', { isAppearing: f => f.id === 2 })).toEqual([2])
    expect(sel('j,P,u', { isAppearing: f => f.id === 3 })).toEqual([3]) // u = U dans le port
    expect(sel('a,U')).toEqual([])
  })

  it('V / v (PV en %, PV en attente), R / r (portail), Q / q (invocations)', () => {
    const hurt = fighter(15, 1, 'monster', { hp: 400, maxHp: 1000 })
    expect(matchesTargetMask('a,A,V50', caster, hurt)).toBe(true)
    expect(matchesTargetMask('a,A,v50', caster, hurt)).toBe(false)
    expect(matchesTargetMask('a,A,V40', caster, hurt)).toBe(false) // strictement inférieur (port D3)
    expect(matchesTargetMask('a,A,v40', caster, hurt)).toBe(true)
    expect(matchesTargetMask('a,A,V50', caster, enemyMonster, { pendingHp: () => 100 })).toBe(true)
    // Souffrance « C,V100,v90 » : le lanceur entre 90 % (inclus) et 100 % (exclu) de ses PV.
    expect(matchesTargetMask('C,V100,v90', caster, caster)).toBe(false)
    const scratched = fighter(17, 0, 'player', { hp: 950, maxHp: 1000 })
    expect(matchesTargetMask('C,V100,v90', scratched, scratched)).toBe(true)
    expect(matchesTargetMask('A,*V100', scratched, enemyMonster)).toBe(true)
    expect(sel('a,A,R')).toEqual([])
    expect(sel('a,A,R', { usingPortal: true }).length).toBe(everyone.length)
    expect(sel('a,A,r').length).toBe(everyone.length)
    expect(casterPassesMask('x,*q', caster)).toBe(true) // 0 invocation < 1
    expect(casterPassesMask('x,*q', caster, { summonCount: () => 1 })).toBe(false)
    expect(casterPassesMask('x,*Q', caster, { summonCount: () => 1 })).toBe(true)
  })

  it('PB / pb (bouclier, INCERTAIN), PR / pr (rappel custom, défaut faux)', () => {
    const shielded = fighter(16, 1, 'monster', { shield: 50 })
    expect(matchesTargetMask('A,PB', caster, shielded)).toBe(true)
    expect(matchesTargetMask('A,pb', caster, shielded)).toBe(false)
    expect(matchesTargetMask('A,pb', caster, enemyMonster)).toBe(true)
    const lance = fighter(20, 0, 'summon', { monsterId: 7139, summonerId: 0 })
    // Disque de Sigel : par défaut PR est faux partout → aucun des deux effets ne s'applique.
    expect(matchesTargetMask('a,P,F7139,pr,*PR', caster, lance)).toBe(false)
    expect(matchesTargetMask('a,P,F7139,PR,*pr', caster, lance)).toBe(false)
    const custom: MaskContext = { custom: (code, f) => code === 'PR' && f.id === 0 }
    expect(matchesTargetMask('a,P,F7139,pr,*PR', caster, lance, custom)).toBe(true)
  })

  it('exemples documentés (effects.md §5) et jetons ignorés Sce / Atq / Def', () => {
    const vortex = fighter(30, 1, 'monster', { monsterId: 3835, states: [221] })
    const ikargn = fighter(31, 1, 'monster', { monsterId: 3834 })
    // Heurage (Vortex) : alliés hors lanceur, sauf Vortex lui-même, si Vortex est en « Première heure ».
    expect(matchesTargetMask('g,*E221,f3835', vortex, ikargn)).toBe(true)
    expect(matchesTargetMask('g,*E221,f3835', vortex, vortex)).toBe(false)
    expect(matchesTargetMask('g,*E221,f3835', { ...vortex, states: [] }, ikargn)).toBe(false)
    // Def/Atq/Sce : reconnus mais sans effet (comme le port) ; seul « Sce » → aucune inclusion.
    expect(sel('Def,A,F3835')).toEqual([4])
    expect(sel('Sce')).toEqual([])
    expect(sel('Atq,a')).toEqual(sel('a'))
  })
})

describe('masques : compilation', () => {
  it('drapeaux, groupes, incertitudes et cache', () => {
    const m = compileTargetMask('a,A,O,K,C,U,*E5,F1,F2,B3')
    expect(m.addsCaster).toBe(true)
    expect(m.addsTriggering).toBe(true)
    expect(m.addsCarried).toBe(true)
    expect(m.lateTargeting).toBe(true)
    expect(m.casterConditions.map(c => c.raw)).toEqual(['*E5'])
    expect(m.targetConditions.map(c => [c.code, c.value, c.group])).toEqual([
      ['O', 0, -1],
      ['K', 0, -1],
      ['U', 0, -1],
      ['F', 1, 0],
      ['F', 2, 0],
      ['B', 3, 1],
    ])
    expect(m.groupCount).toBe(2)
    expect(m.unknown).toEqual([])
    expect(compileTargetMask('a,A,O,K,C,U,*E5,F1,F2,B3')).toBe(m)
    expect(parseTargetMask).toBe(compileTargetMask)
    const odd = compileTargetMask(' a , Zz ,*,E12x,Def,x,u,pb ')
    expect(odd.unknown).toEqual(['Zz', '*', 'E12x'])
    expect(odd.ignored).toEqual(['Def'])
    expect(odd.uncertain).toEqual(['Def', 'x', 'u', 'pb'])
    expect(compileTargetMask('').empty).toBe(true)
    expect(compileTargetMask('A').lateTargeting).toBe(false)
    // Recalcul tardif : U, u, T, W ; V/v seulement en jeton littéral (comme le port), pas V50 / *v50.
    expect(compileTargetMask('a,A,v50').lateTargeting).toBe(false)
    expect(compileTargetMask('a,A,T').lateTargeting).toBe(true)
    expect(compileTargetMask('A,W').lateTargeting).toBe(true)
    expect(compileTargetMask('a,A,V').lateTargeting).toBe(true)
    expect(compileTargetMask('C,*h,e3536').uncertain).toEqual(['*h'])
  })
})
