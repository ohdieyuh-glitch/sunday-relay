/* Round 6 PILOT R5-5 (structural only): the regex import scan becomes a TypeScript-AST scan. It sees static imports,
   `export ... from`, `export * from`, `import x = require()`, require(), import() and import types, and reports any
   require()/import() whose specifier is not a string literal. Rules: no non-test file imports e2-test-kit (so `anchorOf`
   cannot reach production), only the allowed modules import e2-external-anchor, and no non-test julius file loads a
   computed specifier. HONEST LIMIT: this is a repository check, not a runtime boundary. Any same-process code can still
   call the anchor constructor with a reader that returns the evidence file's own hash; the guarantee remains the
   workflow-side anchor reader that Skywalker wires (e2-workflow-anchor-wiring.ts). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import * as A from './e2-external-anchor';

const REPO = join(__dirname, '..', '..');
type Ref = { readonly spec: string | null; readonly kind: string };
function importsOf(source: string, fileName = 'x.ts'): Ref[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Ref[] = [];
  const lit = (e: ts.Node | undefined): string | null => (e !== undefined && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) out.push({ spec: lit(n.moduleSpecifier), kind: 'import' });
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined) out.push({ spec: lit(n.moduleSpecifier), kind: 'export-from' });
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) out.push({ spec: lit(n.moduleReference.expression), kind: 'import-equals' });
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) out.push({ spec: lit(n.argument.literal), kind: 'import-type' });
    else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require' || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve' && ts.isIdentifier(callee.expression) && callee.expression.text === 'require');
      if (isImport || isRequire) out.push({ spec: lit(n.arguments[0]), kind: isImport ? 'dynamic-import' : 'require' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const names = (spec: string | null, mod: string): boolean => spec !== null && new RegExp(`(?:^|/)${mod}(?:\\.[cm]?[jt]sx?)?$`, 'u').test(spec);
function walk(d: string, out: string[]): void {
  for (const n of readdirSync(d)) {
    if (/^(?:node_modules|\.git|dist.*)$/u.test(n)) continue;
    const p = join(d, n); const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(?:[cm]?[jt]sx?)$/u.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
}
const isTest = (f: string): boolean => /\.test\.[cm]?[jt]sx?$/u.test(f);
describe('R5-5: AST import scan', () => {
  it('sees the forms the regex scan missed (re-export, export *, import = require, import type, computed specifiers)', () => {
    const src = "export { anchorOf } from './e2-test-kit';\nexport * from \"./e2-test-kit.js\";\nimport k = require('./e2-test-kit');\ntype T = import('./e2-external-anchor').ExternalAnchor;\nconst m = './e2-' + 'test-kit'; void import(m); require(`./${m}`);\nconst r = require.resolve('./e2-test-kit');\n";
    const refs = importsOf(src);
    expect(refs.filter((r) => names(r.spec, 'e2-test-kit')).map((r) => r.kind)).toEqual(['export-from', 'export-from', 'import-equals', 'require']);
    expect(refs.filter((r) => names(r.spec, 'e2-external-anchor')).map((r) => r.kind)).toEqual(['import-type']);
    expect(refs.filter((r) => r.spec === null).map((r) => r.kind)).toEqual(['dynamic-import', 'require']);
    /* the round-5 regex, for the record: it misses the export-from and import-equals forms */
    const RX = /from\s+['"][^'"]*e2-test-kit['"]|require\(\s*['"][^'"]*e2-test-kit['"]|import\(\s*['"][^'"]*e2-test-kit['"]/gu;
    expect((src.match(RX) ?? []).length).toBe(2);
  });
  const files: string[] = [];
  for (const d of ['relay-bridge', 'scripts', 'src', 'apps', 'packages']) { try { walk(join(REPO, d), files); } catch { /* absent */ } }
  const scanned = files.map((f) => ({ f: relative(REPO, f), refs: importsOf(readFileSync(f, 'utf8'), f) }));
  it('the scan read the repository (sanity)', () => { expect(scanned.length).toBeGreaterThan(50); });
  it('no non-test file imports e2-test-kit in any form', () => {
    expect(scanned.filter(({ f, refs }) => !isTest(f) && refs.some((r) => names(r.spec, 'e2-test-kit'))).map((x) => x.f)).toEqual([]);
  });
  it('only the anchor module, the wiring module, the gate (brand check) and the test kit import e2-external-anchor', () => {
    const allowed = new Set(['relay-bridge/julius/e2-evidence-gate.ts', 'relay-bridge/julius/e2-test-kit.ts', `relay-bridge/julius/${A.E2_ANCHOR_WIRING_MODULE}.ts`]);
    expect(scanned.filter(({ f, refs }) => !isTest(f) && !allowed.has(f) && refs.some((r) => names(r.spec, 'e2-external-anchor'))).map((x) => x.f)).toEqual([]);
  });
  it('no non-test julius file loads a computed specifier', () => {
    expect(scanned.filter(({ f, refs }) => f.startsWith('relay-bridge/julius/') && !isTest(f) && refs.some((r) => r.spec === null)).map((x) => x.f)).toEqual([]);
  });
});
