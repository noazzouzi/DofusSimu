/**
 * Aide des tests de pureté : graphe TRANSITIF des imports d'exécution d'un module TypeScript du dépôt (un module du
 * theorycraft ne doit tirer, même indirectement, ni `node:` ni src/dungeons, docs/design/theorycraft.md §0).
 *
 * Analyse syntaxique par le compilateur TypeScript (dépendance de développement du dépôt), sans exécuter le code :
 *  - relevés : `import … from`, `import 'x'` (effet de bord), `export … from`, `export * from`, `import('x')` et
 *    `require('x')` à argument littéral ;
 *  - ignorés (effacés à la compilation) : `import type`, `export type … from`, et les imports ou ré-exports dont TOUS
 *    les noms sont marqués `type`. Un import de valeur seulement utilisé comme type est compté (prudent : un faux
 *    positif se corrige en écrivant `type`) ;
 *  - résolution : chemins relatifs et alias `@/` (src/), extensions .ts, .tsx, .mts, .js, puis `index.*` ; les autres
 *    spécificateurs (paquets, `node:`) sont rendus à part, non suivis.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

export interface ImportClosure {
  /** Fichiers du dépôt atteints (chemins relatifs à la racine, séparateur « / », entrées comprises), triés. */
  files: string[]
  /** Spécificateurs externes (paquets, `node:`) et le fichier qui les importe. */
  external: { spec: string; from: string }[]
}

/** Spécificateurs importés À L'EXÉCUTION par un source TypeScript (voir l'en-tête). */
export function runtimeImports(source: string, fileName = 'module.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly =
        !!clause &&
        (clause.isTypeOnly ||
          (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(e => e.isTypeOnly)))
      if (!typeOnly) out.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      const typeOnly = node.isTypeOnly || (!!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly))
      if (!typeOnly) out.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamicImport || requireCall) out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js']

function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile()
}

/** Fichier du dépôt d'un spécificateur relatif ou `@/` (undefined : spécificateur externe). */
function resolveLocal(spec: string, fromFile: string, root: string): string | undefined {
  let base: string
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else if (spec.startsWith('@/')) base = join(root, 'src', spec.slice(2))
  else return undefined
  const candidates = [base, ...EXTENSIONS.map(e => base + e), ...EXTENSIONS.map(e => join(base, `index${e}`))]
  const hit = candidates.find(isFile)
  if (!hit) throw new Error(`Import introuvable : « ${spec} » depuis ${relative(root, fromFile)}`)
  return hit
}

/** Fermeture transitive des imports d'exécution depuis `entries` (chemins relatifs à `root`). */
export function runtimeImportClosure(entries: readonly string[], root = process.cwd()): ImportClosure {
  const seen = new Set<string>()
  const external: ImportClosure['external'] = []
  const stack = entries.map(e => resolve(root, e))
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    // JSON et autres ressources : feuilles du graphe.
    if (!EXTENSIONS.some(e => file.endsWith(e))) continue
    for (const spec of runtimeImports(readFileSync(file, 'utf8'), file)) {
      const local = resolveLocal(spec, file, root)
      if (local) stack.push(local)
      else external.push({ spec, from: relative(root, file).split('\\').join('/') })
    }
  }
  const files = [...seen].map(f => relative(root, f).split('\\').join('/')).sort()
  return { files, external }
}
