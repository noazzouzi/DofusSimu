// Règles du combat de la Reine des Voleurs que le moteur ne connaît pas, mesurées sur le combat réel du 2026-10-10
// (fidelite.ts). Appliquées par la mesure de fidélité et par la simulation des manches (round.ts).
//
//  - Reine : dommages subis ×90 % par Bonbombe vivante (buffs 1163 cumulés, multiplicatifs) — 42 coups réels de 1 à 5
//    bombes : écart moyen 26 PV (modèle additif aux dommages finaux : 25 ; aucune réduction : 167) ;
//  - mort de la Reine : les « ×1,5 dommages subis » des sources (docs/strategies/reine-des-voleurs §1.3) ne sont PAS
//    appliqués — les seuls dommages reçus après sa mort le 2026-10-10 (ripostes Avertissement) n'en montrent aucune trace ;
//    à vérifier sur un dommage direct ;
//  - Doublure et sa copie : chaque dommage reçu par l'une est partagé à parts égales entre les deux (36 coups réels) ;
//  - explosion d'une Bonbombe (Nova) : 1 + 999 dommages Feu (« Dommages » 999 de la bombe), résistances Feu déduites,
//    à chaque monstre aligné à 10 cases ou moins, Reine exceptée (6 cas réels : 900 Terristocrate, 700 Mâchassin, 750
//    Doublure par bombe alignée) ;
//  - Bonbombes invulnérables (leur sort de départ, que la simulation ne lance pas) ; Bombe Illicale du Terristocrate aussi
//    (« −0 » à chaque coup, combats du 2026-10-11) ;
//  - monstres de vague : état 399 « Invulnérable » de leur arrivée (sort 6722) à la fin de leur premier tour, et
//    −25 % de vitalité (−1650 sur 6600, −825 sur 3300) ;
//  - Tirs Puissants : son « −3 Portée » (effet 116) ne joue qu'au tour SUIVANT du lanceur (PO 5 → 2 juste après le début
//    de ce tour, de retour à 5 au tour d'après : les 4 Crâs, à chaque lancer) ; le moteur l'appliquait tout de suite ;
//  - riposte « Avertissement » (4783 : 30 dommages Eau au début du tour suivant du tireur) : 3 coups au plus, une seule
//    fois, même si la Magouille est morte entre-temps — 4 à 7 ripostes donnent 3 coups au tour suivant, 0 après (11
//    débuts de tour réels) ; le moteur les cumulait et les gardait.
import type { EffectData } from '../../../src/data/model'
import type { Engine } from '../../../src/engine/engine'
import type { Buff, Fighter, FightState, ScenarioHooks } from '../../../src/engine/types'
import { CELL_X, CELL_Y, distance } from '../../../src/map/geometry'
import { BOMB, QUEEN } from './etat'

/** Bombe Illicale (invoquée par le Terristocrate) : invulnérable, comme les Bonbombes. */
const BOMBE_ILLICALE = 3745

export const DOUBLURE = 3748
/** Sort fictif qui porte les buffs de ces règles (repérés pour être remplacés). */
const RULE_SPELL = -3726
const NOVA_DAMAGE = 1000
/** Riposte de la Magouille (et des monstres dans sa zone), posée sur le tireur. */
const WARNING_POISON = 4783
const WARNING_MAX = 3

/** Début de tour : ripostes Avertissement réduites à 3 coups, chacune une seule fois (celles déjà parties retirées). */
function capWarningPoisons(f: Fighter): void {
  if (!f.buffs.some(b => b.spellId === WARNING_POISON)) return
  const others = f.buffs.filter(b => b.spellId !== WARNING_POISON)
  const fresh = f.buffs.filter(b => b.spellId === WARNING_POISON && !(b.triggerCount ?? 0)).slice(0, WARNING_MAX)
  // Buffs remplacés par des copies (objets partagés entre clones, src/engine/cow.ts).
  f.buffs = [...others, ...fresh.map(b => ({ ...b, maxTriggers: 1 }))]
}

/**
 * Scénario du moteur pour ce combat : pas de fin décidée par le moteur (de nouvelles vagues arrivent quand tous les
 * monstres sont morts), Bonbombes invulnérables, monstres de vague invulnérables jusqu'à la fin de leur premier tour
 * (`tags.arrivalShield`, posé par qui les fait apparaître).
 */
export const reineScenario: ScenarioHooks = {
  id: 'reine-des-voleurs',
  checkEnd: () => null,
  canBeDamaged: (_fight, target) => target.monsterId !== BOMB && target.monsterId !== BOMBE_ILLICALE && !target.tags.arrivalShield,
  onTurnStart: (_fight, f) => capWarningPoisons(f),
  onTurnEnd: (_fight, f) => {
    if (f.tags.arrivalShield) delete f.tags.arrivalShield
  },
}

function receivedDamage(pct: number): EffectData {
  return {
    effectId: 1163, order: 0, diceNum: pct, diceSide: 0, value: pct, duration: -1, delay: 0, random: 0, group: 0,
    targetMask: 'a,A', targetId: 0, triggers: 'I', dispellable: 4, element: -1,
    zone: { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
  }
}

/** Remplace les buffs de règle `label` d'un combattant par `n` buffs « dommages subis ×pct % ». */
function setRuleBuffs(engine: Engine, fight: FightState, f: Fighter, label: string, n: number, pct: number): void {
  const mine = (b: Buff) => b.spellId === RULE_SPELL && b.label === label
  const have = f.buffs.filter(mine).length
  if (have === n) return
  const kept = f.buffs.filter(b => !mine(b))
  const added: Buff[] = []
  for (let i = 0; i < n; i++) {
    added.push({ uid: engine.uid(fight), sourceId: f.id, spellId: RULE_SPELL, effect: receivedDamage(pct), value: pct, remaining: -1,
      delay: 0, dispellable: false, label, kind: 'special' })
  }
  // Tableau remplacé, jamais modifié en place (partagé entre clones, src/engine/cow.ts).
  f.buffs = [...kept, ...added]
}

/** Met à jour les règles qui dépendent de l'état du combat (réduction de la Reine par bombe vivante). À appeler avant chaque action. */
export function applyStateRules(engine: Engine, fight: FightState): void {
  const bombs = fight.fighters.filter(f => f.alive && f.monsterId === BOMB).length
  for (const q of fight.fighters) if (q.alive && q.monsterId === QUEEN) setRuleBuffs(engine, fight, q, 'Bonbombes vivantes', bombs, 90)
}

const TIRS_PUISSANTS = 32466
const RANGE_MALUS = 116
const DELAYED = ' (tour suivant)'

/** Après un lancer : règles propres à certains sorts (malus de portée de Tirs Puissants différé d'un tour). */
export function applyCastRules(engine: Engine, fight: FightState, caster: Fighter, spellId: number): void {
  if (spellId !== TIRS_PUISSANTS) return
  let changed = false
  // Buffs remplacés par des copies (objets partagés entre clones, src/engine/cow.ts).
  caster.buffs = caster.buffs.map(b => {
    if (b.spellId !== TIRS_PUISSANTS || b.effect.effectId !== RANGE_MALUS || b.delay > 0 || b.label.endsWith(DELAYED)) return b
    changed = true
    return { ...b, delay: 1, label: b.label + DELAYED }
  })
  if (changed) engine.recomputeStats(caster)
}

/** Paires Doublure / copie (invocation de même monstre que son invocateur), identifiants du moteur. */
export function twinPairs(fight: FightState): [number, number][] {
  const out: [number, number][] = []
  for (const f of fight.fighters) {
    if (f.monsterId !== DOUBLURE || f.summonerId === undefined) continue
    const o = fight.fighters[f.summonerId]
    if (o?.monsterId === DOUBLURE) out.push([o.id, f.id])
  }
  return out
}

/** PV avant une action, pour le partage des dommages entre jumelles (`shareTwinDamage`). */
export function twinHp(fight: FightState): Map<number, number> {
  const m = new Map<number, number>()
  for (const [a, b] of twinPairs(fight)) {
    m.set(a, fight.fighters[a].alive ? fight.fighters[a].hp : 0)
    m.set(b, fight.fighters[b].alive ? fight.fighters[b].hp : 0)
  }
  return m
}

/** Après une action : les PV perdus par les deux jumelles sont répartis à parts égales ; l'une morte, l'autre aussi. */
export function shareTwinDamage(engine: Engine, fight: FightState, before: Map<number, number>): void {
  for (const [a, b] of twinPairs(fight)) {
    const fa = fight.fighters[a]
    const fb = fight.fighters[b]
    const ha = before.get(a)
    const hb = before.get(b)
    if (ha === undefined || hb === undefined || (!fa.alive && !fb.alive && ha <= 0 && hb <= 0)) continue
    const lost = Math.max(0, ha - (fa.alive ? fa.hp : 0)) + Math.max(0, hb - (fb.alive ? fb.hp : 0))
    if (lost <= 0) continue
    const half = Math.round(lost / 2)
    for (const [f, h] of [[fa, ha], [fb, hb]] as const) {
      const hp = h - half
      if (hp <= 0) {
        if (f.alive) engine.kill(fight, f)
      } else {
        if (!f.alive) {
          f.alive = true
        }
        f.hp = hp
      }
    }
  }
}

const inLine10 = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10

/** Dommages d'une explosion de Bonbombe en `cell` aux monstres (identifiant du moteur → PV), avant partage des jumelles. */
export function novaDamage(fight: FightState, cell: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const f of fight.fighters) {
    if (!f.alive || f.team !== 1 || f.monsterId === QUEEN || f.monsterId === BOMB || !inLine10(cell, f.cell)) continue
    const dmg = Math.max(0, Math.floor((NOVA_DAMAGE * (100 - f.stats.fireResPct)) / 100) - f.stats.fireRes)
    if (dmg > 0) out.set(f.id, dmg)
  }
  return out
}

/** Applique l'explosion d'une Bonbombe en `cell` aux monstres alignés (jumelles comprises). */
export function applyNova(engine: Engine, fight: FightState, cell: number): void {
  const before = twinHp(fight)
  for (const [id, dmg] of novaDamage(fight, cell)) engine.applyDamage(fight, undefined, fight.fighters[id], dmg, 2, 'indirect')
  shareTwinDamage(engine, fight, before)
}
