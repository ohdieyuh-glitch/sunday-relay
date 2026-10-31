/**
 * Round 8 R7-3 (Skywalker ba9ee244, PILOT): the base content of a pinned test/entry file is checked by an ALLOWLIST over
 * a TypeScript parse (the `typescript` package the repo already carries), not by a lexical blacklist.
 *
 * Accepted only if ALL hold; otherwise a named refusal:
 *  - it parses with no syntax diagnostics (else `spec_pinned_test_unparsed`);
 *  - every module load is a literal `import ... from '<x>'`, `export ... from '<x>'`, `import '<x>'` or `require('<x>')`
 *    with <x> in {@link E2_PINNED_IMPORT_ALLOWLIST} (else `spec_pinned_test_imports_untrusted`);
 *  - no identifier is written with a unicode escape; no `import(...)`, `import x = require()`, `with`, tagged template,
 *    `require` other than called with one literal, `import.meta` other than `.url`/`.dirname`/`.filename`, computed member
 *    access or computed property/binding name whose key is not a literal, and no identifier or literal key in
 *    {@link E2_PINNED_BANNED_NAMES} in ANY position (else `spec_pinned_test_dynamic_load`);
 *  - no `NODE_TEST_` text anywhere, and no non-literal `env[...]` (else `spec_pinned_test_context_reference`).
 * Priority when several apply: unparsed > context_reference > imports_untrusted > dynamic_load.
 *
 * TRUST ASSUMPTION: base files are the mission seed's own. This allowlist removes the known routes from a pinned file to
 * coder code or to process-level hooks; it is not a sandbox. What remains: node:fs can read and write files (it cannot
 * execute them without a banned loader), and a route through an allowed built-in this list does not know about.
 */
import * as ts from 'typescript';

export type E2PinnedScanRefusal = 'spec_pinned_test_imports_untrusted' | 'spec_pinned_test_dynamic_load' | 'spec_pinned_test_context_reference' | 'spec_pinned_test_unparsed';

const BASE_ALLOW = ['assert', 'assert/strict', 'fs', 'fs/promises', 'path', 'path/posix', 'test', 'url', 'util'];
/** Exact module specifiers a pinned file may load. `test` is node:test-only (the bare `test` is a package name). */
export const E2_PINNED_IMPORT_ALLOWLIST: ReadonlySet<string> = new Set([...BASE_ALLOW.map((b) => `node:${b}`), ...BASE_ALLOW.filter((b) => b !== 'test')]);
/** Names refused as an identifier in any position, or as a literal member key. */
export const E2_PINNED_BANNED_NAMES: ReadonlySet<string> = new Set([
  'globalThis', 'global', 'process', 'Reflect', 'Proxy', 'Function', 'eval', 'module', 'WebAssembly', 'Symbol',
  'constructor', '__proto__', 'prototype', 'getBuiltinModule', 'createRequire', 'binding', '_linkedBinding', 'dlopen', 'mainModule',
  '_load', '_compile', 'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'defineProperty',
  'defineProperties', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'prepareStackTrace', 'run',
  'AsyncFunction', 'GeneratorFunction',
]);
const META_OK = new Set(['url', 'dirname', 'filename']);
const literalKey = (e: ts.Node): string | null =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : ts.isNumericLiteral(e) ? e.text : null;

export function scanPinnedSourceAst(src: string): E2PinnedScanRefusal | null {
  const sf = ts.createSourceFile('pinned.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (!Array.isArray(diags) || diags.length > 0) return 'spec_pinned_test_unparsed';
  const found = new Set<E2PinnedScanRefusal>();
  if (/NODE_TEST_/u.test(src)) found.add('spec_pinned_test_context_reference');
  const dyn = (): void => { found.add('spec_pinned_test_dynamic_load'); };
  const loadSpec = (spec: ts.Node | undefined): void => {
    const s = spec === undefined ? null : literalKey(spec);
    if (s === null || ts.isNumericLiteral(spec as ts.Node)) dyn();
    else if (!E2_PINNED_IMPORT_ALLOWLIST.has(s)) found.add('spec_pinned_test_imports_untrusted');
  };
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      const name = ts.isIdentifier(n) ? ts.idText(n) : n.text;
      if (n.getText(sf) !== name) dyn(); /* written with a unicode escape */
      if (E2_PINNED_BANNED_NAMES.has(name.replace(/^#/u, ''))) dyn();
      if (name === 'require') {
        const p = n.parent;
        const ok = ts.isCallExpression(p) && p.expression === n && p.arguments.length === 1;
        if (!ok) dyn(); else loadSpec(p.arguments[0]);
      }
    }
    if (ts.isImportDeclaration(n) || (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined)) loadSpec(n.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(n) || ts.isWithStatement(n) || ts.isTaggedTemplateExpression(n)) dyn();
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) dyn();
    if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
      if (!(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && META_OK.has(ts.idText(n.parent.name as ts.Identifier)))) dyn();
    }
    if (ts.isElementAccessExpression(n)) {
      const k = literalKey(n.argumentExpression);
      if (k === null) {
        dyn();
        const obj = n.expression;
        if ((ts.isIdentifier(obj) && obj.text === 'env') || (ts.isPropertyAccessExpression(obj) && ts.idText(obj.name as ts.Identifier) === 'env')
          || (ts.isElementAccessExpression(obj) && literalKey(obj.argumentExpression) === 'env')) found.add('spec_pinned_test_context_reference');
      } else if (E2_PINNED_BANNED_NAMES.has(k) || k === 'require') dyn();
    }
    if (ts.isComputedPropertyName(n)) {
      const k = literalKey(n.expression);
      if (k === null || E2_PINNED_BANNED_NAMES.has(k) || k === 'require') dyn();
    }
    if ((ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.parent !== undefined) {
      const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
      if ((p.name === n || p.propertyName === n) && (E2_PINNED_BANNED_NAMES.has(n.text) || n.text === 'require')) dyn();
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const r of ['spec_pinned_test_context_reference', 'spec_pinned_test_imports_untrusted', 'spec_pinned_test_dynamic_load'] as const) if (found.has(r)) return r;
  return null;
}
