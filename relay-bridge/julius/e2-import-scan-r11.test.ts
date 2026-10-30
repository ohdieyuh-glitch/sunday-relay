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
      /* Round 7 PILOT R6-7: x.require(...) (module.require, process.mainModule.require) and createRequire(...) */
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'require') out.push({ spec: lit(n.arguments[0]), kind: 'module-require' });
      else if (ts.isIdentifier(callee) && callee.text === 'createRequire' || ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRequire') out.push({ spec: null, kind: 'create-require' });
      else if (ts.isIdentifier(callee) && (callee.text === 'eval' || callee.text === 'Function') || ts.isPropertyAccessExpression(callee) && callee.name.text === 'eval') out.push({ spec: null, kind: 'eval' });
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Function') out.push({ spec: null, kind: 'eval' });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const names = (spec: string | null, mod: string): boolean => spec !== null && new RegExp(`(?:^|/)${mod}(?:\\.[cm]?[jt]sx?)?$`, 'iu').test(spec);
function walk(d: string, out: string[]): void {
  for (const n of readdirSync(d)) {
    if (/^(?:node_modules|\.git|dist.*)$/iu.test(n)) continue;
    const p = join(d, n); const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(?:[cm]?[jt]sx?)$/u.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
}
/** Round 7 PILOT R6-7: every top-level folder (not a fixed list), minus dependencies, VCS and build output. */
function topLevelDirs(): string[] {
  return readdirSync(REPO).filter((n) => !/^(?:node_modules|\.git|dist.*|coverage|\.next|\.turbo|\.vercel)$/iu.test(n) && statSync(join(REPO, n)).isDirectory());
}
const isTest = (f: string): boolean => /\.test\.[cm]?[jt]sx?$/u.test(f);
describe('Round 7 PILOT R6-7: the scan sees createRequire, module.require, eval/Function, case changes, every folder', () => {
  it('createRequire, module.require and process.mainModule.require are loads; eval and Function are computed loads', () => {
    const src = "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url); r('./e2-test-kit');\nmodule.require('./e2-test-kit');\nprocess.mainModule.require('./e2-test-kit');\neval(\"require('./e2-test-kit')\");\nnew Function('return 1');\nFunction('x')();\nglobalThis.eval('1');\n";
    const refs = importsOf(src);
    expect(refs.filter((r) => r.kind === 'create-require').length).toBe(1);
    expect(refs.filter((r) => names(r.spec, 'e2-test-kit')).map((r) => r.kind)).toEqual(['module-require', 'module-require']);
    expect(refs.filter((r) => r.kind === 'eval').length).toBe(4);
  });
  it('a case change in the specifier still names the module (case-insensitive file systems)', () => {
    expect(names('./E2-Test-Kit', 'e2-test-kit')).toBe(true);
    expect(names('./e2-EXTERNAL-anchor.TS', 'e2-external-anchor')).toBe(true);
  });
  it('every top-level folder is walked, not a fixed list', () => {
    expect(topLevelDirs().length).toBeGreaterThanOrEqual(5);
    expect(topLevelDirs()).not.toContain('node_modules');
    expect(topLevelDirs()).not.toContain('.git');
  });
});
describe('R5-5: AST import scan', { timeout: 30_000 }, () => {
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
  for (const d of topLevelDirs()) walk(join(REPO, d), files);
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
  /* Round 7 PILOT R6-7: computed loads outside julius. These files are outside the adapter's path rule (relay-bridge/julius/
     only), so they are pinned as a ratchet: any NEW non-test file with a computed load (require/import/x.require of a
     non-literal, createRequire, eval, Function) anywhere in the repository fails this test. */
  it('computed loads outside julius are exactly the known, pinned set (ratchet)', () => {
    const KNOWN = [
      'relay-bridge/hosted-coding-agent/hosted-login-probe.ts', 'relay-bridge/hosted-coding-agent/hosted-readiness.ts',
      'relay-bridge/hosted-coding-agent/hosted-runner.ts', 'relay-bridge/wonderland-eval-runtime.ts',
      'scripts/export-julius-harness.mjs', 'scripts/relay-card-seam-browser-verify.mjs',
      'src/relay/mission/wonderland/wonderland-eval-adjudication.ts', 'src/relay/mission/wonderland/wonderland-execution.ts',
      'src/relay/mission/wonderland/wonderland-gve-runtime.ts', 'src/relay/mission/wonderland/wonderland-provider-ledger.ts',
    ];
    expect(scanned.filter(({ f, refs }) => !isTest(f) && refs.some((r) => r.spec === null)).map((x) => x.f).sort()).toEqual(KNOWN);
  });
});
