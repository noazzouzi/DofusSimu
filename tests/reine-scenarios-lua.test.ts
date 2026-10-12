/**
 * Script Lua des scénarios (modele-rejeu.lua, tel que généré pour ReineCombat.lua) exécuté par un interpréteur Lua, avec
 * une API AnkaBot simulée : placement, tour d'une situation connue joué sans serveur, monstre lointain toléré,
 * situation inconnue confiée au serveur de plans (IA_tour), écart pendant un tour (suite par le serveur), serveur absent.
 * Sauté si aucun interpréteur Lua (lua, lua5.1…) n'est installé.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { distance } from '../src/map/geometry'
import { rejeuPart } from '../tools/fightlog/scenario'
import { fightsOfFile } from '../tools/reine-des-voleurs/scenarios/apprendre'
import { addFight, emptyLibrary } from '../tools/reine-des-voleurs/scenarios/bibliotheque'
import { compilePlacement, LOIN } from '../tools/reine-des-voleurs/scenarios/compilation'
import type { Registry } from '../tools/reine-des-voleurs/scenarios/placements'
import { ALPHA, BETA, typicalFight, writeSession } from './helpers/reine-synthetique'

const LUA = ['lua', 'lua5.1', 'lua5.4', 'lua5.3', 'luajit'].find(bin => {
  try {
    execFileSync(bin, ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})

const tmp = mkdtempSync(join(tmpdir(), 'reine-lua-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Script de rejeu généré pour un placement appris de deux combats types (Alpha : sortie en 340, tir, retour en 354). */
function script(): string {
  const reg: Registry = { version: 1, carte: 137101316, personnages: { Alpha: ALPHA, Beta: BETA }, placements: [
    { nom: 'P', monstres: [{ espece: 3726, cellule: 133 }, { espece: 3746, cellule: 135 }], cases: { Alpha: 354, Beta: 381 }, colonne: { Alpha: 354, Beta: 381 } },
  ] }
  const lib = emptyLibrary('P')
  for (const k of [1, 2]) addFight(lib, `combat-${k}`, fightsOfFile(writeSession(join(tmp, `logs-${k}`), 'session-10-00-00', [typicalFight()]))[0].scenario!)
  const file = join(tmp, 'rejeu.lua')
  writeFileSync(file, rejeuPart([compilePlacement(reg, reg.placements[0], lib)], process.cwd(), 'test', { loin: LOIN }))
  return file
}

const MOCK = `
etat = { case = 340, pa = 12, pm = 6, monTour = true, pv = 4000, manche = 1, entites = {}, refus = {} }
local function log(s) io.write(s, "\\n") end
global = {}
function global:printMessage(t) end
function global:printSuccess(t) end
function global:printError(t) end
function global:delay(ms) end
function global:getCurrentScriptDirectory() return TMP end
function global:finishScript() log("FIN_SCRIPT") end
character = {}
function character:name() return "Alpha" end
function character:id() return ${ALPHA} end
fightCharacter = {}
function fightCharacter:getCellId() return etat.case end
function fightCharacter:getId() return ${ALPHA} end
function fightCharacter:getAP() return etat.pa end
function fightCharacter:getMP() return etat.pm end
function fightCharacter:isItMyTurn() return etat.monTour end
function fightCharacter:getLifePoints() return etat.pv end
fightAction = {}
function fightAction:getAllEntities()
  local out = { { Id = ${ALPHA}, CellId = etat.case, LifePoints = 4000, CreatureGenericId = 0, Team = false } }
  for _, e in ipairs(etat.entites) do out[#out + 1] = e end
  return out
end
function fightAction:getCurrentTurn() return etat.manche end
function fightAction:canCastSpellOnCell(depuis, sort, cell) return 0 end
function fightAction:castSpellOnCell(sort, cell)
  if etat.refus[sort] then log("REFUS " .. sort .. " " .. cell) return false end
  log("SORT " .. sort .. " " .. cell)
  return true
end
function fightAction:moveToWardCell(c) log("VERS " .. c) etat.case = c end
function fightAction:getShortestPath(a, b, eviter) return { b } end
function fightAction:getDistance(a, b) return 1 end
function fightAction:chooseCell(c) etat.case = c end
fightBasic = {}
function fightBasic:playTurn() log("IA_BASIQUE") end
developer = {}
function developer:createMessage(n) return {} end
function developer:sendMessage(m) if m.fwkr then etat.case = m.fwkr end end
function developer:createMessageFromJson(n, j) return {} end
map = {}
function map:currentMapId() return 137101316 end
IA_tour = function(debut, repli)
  log("IA_TOUR " .. tostring(debut))
  if SERVEUR_ABSENT then repli("serveur injoignable") end
end
`

const ent = (id: number, cell: number, espece = 0) => `{ Id = ${id}, CellId = ${cell}, LifePoints = 100, CreatureGenericId = ${espece}, Team = ${espece !== 0 && espece !== 3725} }`
/** Plateau du tour 1 d'Alpha (Beta, la Reine, le Mâchassin ; sa bombe du tour pas encore apparue). */
const TOUR1 = `{ ${ent(BETA, 381)}, ${ent(-5, 133, 3726)}, ${ent(-6, 135, 3746)} }`
/** Plateau du tour 2 d'Alpha : bombes de la manche 1, Reine en `queen`, Mâchassin en `mach`. */
const tour2 = (queen: number, mach = 135) => `{ ${ent(BETA, 381)}, ${ent(-10, 326, 3725)}, ${ent(-11, 353, 3725)}, ${ent(-5, queen, 3726)}, ${ent(-6, mach, 3746)} }`

function run(body: string): string[] {
  SCRIPT ||= script()
  const file = join(tmp, `banc-${Math.random().toString(36).slice(2)}.lua`)
  writeFileSync(file, `TMP = ${JSON.stringify(tmp)}\n${MOCK}\ndofile(${JSON.stringify(SCRIPT)})\n` +
    `fightManagementPosition({}, { [133] = -5, [135] = -6 })\nlocal function log(s) io.write(s, "\\n") end\n${body}\n`)
  return execFileSync(LUA!, [file], { encoding: 'utf8' }).trim().split('\n')
}

let SCRIPT = ''

describe.skipIf(!LUA)('scénarios en Lua (API AnkaBot simulée)', () => {
  it('placement, puis tours d’une situation connue joués tout de suite, sans serveur', () => {
    const out = run(`
log("PLACE " .. etat.case)
etat.entites = ${TOUR1}
fightManagement()
log("--")
etat.manche, etat.pm = 2, 6
etat.entites = ${tour2(161)}
fightManagement()`)
    expect(out).toEqual(['PLACE 354', 'VERS 340', 'SORT 32437 133', 'VERS 354', '--', 'VERS 340', 'SORT 32437 161', 'VERS 354'])
  })

  it('Mâchassin loin, ailleurs que dans la situation (loin aussi) : toléré ; Reine ailleurs : le serveur joue ce tour', () => {
    const far = [...Array(560).keys()].find(c => c !== 135 && [354, 381, 340].every(x => distance(x, c) >= LOIN[3746]))!
    const out = run(`
etat.entites = ${TOUR1}
fightManagement()
etat.manche, etat.pm = 2, 6
etat.entites = ${tour2(161, far)}
fightManagement()
log("--")
etat.manche, etat.pm = 3, 6
etat.entites = { ${ent(BETA, 381)}, ${ent(-5, 300, 3726)} }
fightManagement()`)
    expect(out.slice(3)).toEqual(['VERS 340', 'SORT 32437 161', 'VERS 354', '--', 'IA_TOUR 354'])
  })

  it('sort refusé pendant un tour du scénario : le serveur joue la suite ; PM insuffisants : situation écartée', () => {
    const out = run(`
etat.refus[32437] = true
etat.entites = ${TOUR1}
fightManagement()
log("--")
etat.refus = {}
etat.case, etat.manche, etat.pm = 354, 2, 1
etat.entites = ${tour2(161)}
fightManagement()`)
    expect(out).toEqual(['VERS 340', 'REFUS 32437 133', 'IA_TOUR 354', '--', 'IA_TOUR 354'])
  })

  it('serveur absent pour une situation inconnue : tour passé (SI_SERVEUR_ABSENT)', () => {
    const out = run(`
SERVEUR_ABSENT = true
etat.entites = { ${ent(BETA, 381)}, ${ent(-5, 300, 3726)}, ${ent(-6, 135, 3746)} }
fightManagement()
log("FIN " .. etat.case)`)
    expect(out).toEqual(['IA_TOUR 354', 'FIN 354'])
  })
})
