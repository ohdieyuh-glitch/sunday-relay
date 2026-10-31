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
 *    access whose key is not a literal (except a pure index read, see indexOk) or computed property/binding name whose key is not a literal, and no identifier or literal key in
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

const BASE_ALLOW = ['assert', 'assert/strict', 'crypto', 'fs', 'fs/promises', 'path', 'path/posix', 'test', 'url', 'util'];
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
/** Round 9 N8-1: strings that name the route from any value to Function / a prototype. */
const PROTO_STRINGS: ReadonlySet<string> = new Set(['constructor', '__proto__', 'prototype']);
/** Round 9 (PILOT R8-1): no string the scan can fold may equal one of these, in ANY position (a string is never proven
 *  inert; the simplest sound rule is to refuse it). */
export const E2_PINNED_BANNED_STRINGS: ReadonlySet<string> = new Set([...PROTO_STRINGS, ...E2_PINNED_BANNED_NAMES,
  'require', 'child_process', 'vm', 'worker_threads', 'inspector', 'module', 'cluster', 'net', 'http', 'https', 'dgram', 'dns', 'tls', 'wasi', 'sqlite']);
/** Constant-folds a string expression made of literals, `+` and templates; null when any part is not constant. */
function foldString(e: ts.Node): string | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e)) return foldString(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldString(e.left); const r = foldString(e.right); return l === null || r === null ? null : l + r;
  }
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const sp of e.templateSpans) { const v = foldString(sp.expression); if (v === null) return null; out += v + sp.literal.text; }
    return out;
  }
  return null;
}
const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) ? unwrap(e.expression) : e);
const isFunctionLike = (e: ts.Expression): boolean => { const u = unwrap(e); return ts.isArrowFunction(u) || ts.isFunctionExpression(u) || ts.isClassExpression(u); };
const literalKey = (e: ts.Node): string | null =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : ts.isNumericLiteral(e) ? e.text : null;

/** A non-literal key is allowed only as an index: identifiers, numbers and + - * / % of them (e.g. `src[i + 1]`), and the
 *  result is a VALUE: not called, not constructed, not indexed again, not a tagged template tag.
 *  Round 9 (Skywalker N8-1) CORRECTION: the round 8 comment here claimed one dynamic step "never" reaches a callable
 *  Function. That was wrong: `const F = (()=>0)['constr'+'uctor']` is one index read whose VALUE is Function, and calling
 *  `F` later is a plain call of an identifier. Closed in depth by (1) refusing any member/index access on a function, arrow
 *  or class expression, (2) refusing any string the scan can fold (literal, `+` concatenation, template) equal to
 *  'constructor', '__proto__' or 'prototype', and (3) the structural fix: every verifier child runs with
 *  --disallow-code-generation-from-strings (e2-evidence-gate.ts), so a Function reached by a route the scan does not see
 *  (e.g. a key built with Array#join) still cannot compile a string. */
const isIndexExpr = (e: ts.Expression): boolean =>
  ts.isIdentifier(e) || ts.isNumericLiteral(e) || (ts.isParenthesizedExpression(e) && isIndexExpr(e.expression))
  || (ts.isBinaryExpression(e) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken].includes(e.operatorToken.kind) && isIndexExpr(e.left) && isIndexExpr(e.right));
/** Round 9 (PILOT R8-1, Skywalker N8-1): an identifier/arithmetic-keyed index read is allowed only when its VALUE provably
 *  goes nowhere it could be called: a comparison operand, a string concatenation (`+`, `+=` onto an identifier, a template
 *  span), the left of `??` / a conditional test (then judged by where that goes), the argument of a RegExp literal's
 *  `.test`, an argument of an assert method imported from node:assert, or a `const` binding whose EVERY use is one of
 *  these. Calling, constructing, indexing, member-reading, assigning to it, passing it to any other function, returning it,
 *  or storing it in a mutable binding / object / array is refused. A literal string key must also not be a banned name. */
const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken]);
const ASSERT_METHODS = new Set(['equal', 'strictEqual', 'notEqual', 'notStrictEqual', 'deepEqual', 'deepStrictEqual', 'notDeepEqual', 'notDeepStrictEqual', 'ok']);
interface FlowCtx { readonly sf: ts.SourceFile; readonly assertNames: ReadonlySet<string>; readonly refs: ReadonlyMap<string, readonly ts.Identifier[]>; }
function valueInert(node: ts.Node, ctx: FlowCtx, depth = 0): boolean {
  if (depth > 8) return false;
  let child: ts.Node = node; let p: ts.Node = node.parent;
  while (ts.isParenthesizedExpression(p)) { child = p; p = p.parent; }
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (COMPARE.has(op)) return true;
    if (op === ts.SyntaxKind.PlusToken) return true; /* string/number coercion only */
    if (op === ts.SyntaxKind.PlusEqualsToken) return p.right === child && ts.isIdentifier(p.left);
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken) return valueInert(p, ctx, depth + 1);
    return false;
  }
  if (ts.isTemplateSpan(p)) return !ts.isTaggedTemplateExpression(p.parent.parent);
  if (ts.isConditionalExpression(p)) return p.condition === child;
  if (ts.isIfStatement(p) || ts.isWhileStatement(p)) return p.expression === child;
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isCallExpression(p) && p.expression !== child && p.arguments.includes(child as ts.Expression)) {
    const c = p.expression;
    if (ts.isPropertyAccessExpression(c) && ts.idText(c.name) === 'test' && ts.isRegularExpressionLiteral(c.expression)) return true;
    if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && ctx.assertNames.has(ts.idText(c.expression)) && ASSERT_METHODS.has(ts.idText(c.name))) return true;
    if (ts.isIdentifier(c) && ctx.assertNames.has(ts.idText(c))) return true;
    return false;
  }
  if (ts.isVariableDeclaration(p) && p.initializer === child && ts.isIdentifier(p.name)
    && ts.isVariableDeclarationList(p.parent) && (p.parent.flags & ts.NodeFlags.Const) !== 0) {
    const uses = (ctx.refs.get(ts.idText(p.name)) ?? []).filter((r) => r !== p.name);
    return uses.every((u) => valueInert(u, ctx, depth + 1));
  }
  return false;
}
export function scanPinnedSourceAst(src: string): E2PinnedScanRefusal | null {
  const sf = ts.createSourceFile('pinned.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (!Array.isArray(diags) || diags.length > 0) return 'spec_pinned_test_unparsed';
  const found = new Set<E2PinnedScanRefusal>();
  const assertNames = new Set<string>(); const refs = new Map<string, ts.Identifier[]>();
  const collect = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) { const t = ts.idText(n); const a = refs.get(t) ?? []; a.push(n); refs.set(t, a); }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^(node:)?assert(\/strict)?$/u.test(n.moduleSpecifier.text) && n.importClause !== undefined) {
      const c = n.importClause; if (c.name !== undefined) assertNames.add(ts.idText(c.name));
      const b = c.namedBindings;
      if (b !== undefined && ts.isNamespaceImport(b)) assertNames.add(ts.idText(b.name));
      if (b !== undefined && ts.isNamedImports(b)) for (const e of b.elements) { const pn = e.propertyName ?? e.name; if (ts.isIdentifier(pn) && ASSERT_METHODS.has(ts.idText(pn))) assertNames.add(ts.idText(e.name)); }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  for (const name of [...assertNames]) {
    const declared = (refs.get(name) ?? []).some((r) => { const q = r.parent; return (ts.isVariableDeclaration(q) || ts.isParameter(q) || ts.isFunctionDeclaration(q) || ts.isClassDeclaration(q) || ts.isBindingElement(q)) && (q as { name?: ts.Node }).name === r; });
    if (declared) assertNames.delete(name);
  }
  const ctx: FlowCtx = { sf, assertNames, refs };
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
    /* Round 9 N8-1: no member or index access on a function, arrow or class expression, and no foldable string naming
       the prototype route anywhere (a literal, a concatenation or a template, in any position). */
    if ((ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n)) && isFunctionLike(n.expression)) dyn();
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const v = foldString(n); if (v !== null && (E2_PINNED_BANNED_STRINGS.has(v) || E2_PINNED_BANNED_STRINGS.has(v.replace(/^node:/u, '')))) dyn();
    }
    if (ts.isElementAccessExpression(n)) {
      const k = literalKey(n.argumentExpression);
      if (k === null) {
        if (!isIndexExpr(n.argumentExpression) || !valueInert(n, ctx)) dyn();
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
