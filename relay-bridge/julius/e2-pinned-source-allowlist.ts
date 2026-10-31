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
import type * as ts from 'typescript';

/* Round 9 (Skywalker N8-4 / PILOT R8-4): typescript is loaded lazily and guarded, so a bundled gate or a tree without
   node_modules refuses with the named `e2_scanner_unavailable` instead of throwing at import time. A synchronous
   guarded require is used, not import(): the scan (and pinVerifierSpec's call to it) is synchronous; the guard is the same
   (any throw or a module without createSourceFile -> null -> e2_scanner_unavailable). */
type TsModule = typeof import('typescript');
let L: TsModule | null | undefined;
function loadTs(): TsModule | null {
  if (L !== undefined) return L;
  try {
    const m = require('typescript') as TsModule;
    L = typeof m?.createSourceFile === 'function' ? m : null;
  } catch { L = null; }
  return L;
}
/** Round 9 (PILOT R8-5): byte cap and bracket-nesting cap checked before the parse. */
export const E2_PINNED_MAX_BYTES = 256 * 1024;
export const E2_PINNED_MAX_DEPTH = 256;

export type E2PinnedScanRefusal = 'spec_pinned_test_imports_untrusted' | 'spec_pinned_test_dynamic_load' | 'spec_pinned_test_context_reference' | 'spec_pinned_test_unparsed'
  /** Round 9 (Skywalker N8-2): `<!--` or `-->` anywhere (node's CommonJS script goal reads them as line comments; TypeScript does not). */
  | 'spec_pinned_test_html_comment'
  /** Round 9 (PILOT R8-5): larger than E2_PINNED_MAX_BYTES, nested deeper than E2_PINNED_MAX_DEPTH, or the parse/walk threw. */
  | 'spec_pinned_test_too_large' | 'spec_pinned_test_too_deep' | 'spec_pinned_test_scan_failed'
  /** Round 10 (Skywalker F9-3): an import binding is assigned, deleted, ++/--'d, a destructuring target, reassigned or
   *  shadowed (on itself or any member chain rooted at it), or an assert/test import escapes as a value. */
  | 'spec_pinned_test_import_mutated'
  /** Round 9 (N8-4 / R8-4): the typescript parser could not be loaded (e.g. a bundled gate with node_modules absent). */
  | 'e2_scanner_unavailable';

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
  if (L!.isStringLiteral(e) || L!.isNoSubstitutionTemplateLiteral(e) || L!.isNumericLiteral(e)) return e.text;
  if (L!.isParenthesizedExpression(e)) return foldString(e.expression);
  if (L!.isBinaryExpression(e) && e.operatorToken.kind === L!.SyntaxKind.PlusToken) {
    const l = foldString(e.left); const r = foldString(e.right); return l === null || r === null ? null : l + r;
  }
  if (L!.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const sp of e.templateSpans) { const v = foldString(sp.expression); if (v === null) return null; out += v + sp.literal.text; }
    return out;
  }
  return null;
}
const unwrap = (e: ts.Expression): ts.Expression => (L!.isParenthesizedExpression(e) || L!.isNonNullExpression(e) || L!.isAsExpression(e) ? unwrap(e.expression) : e);
const isFunctionLike = (e: ts.Expression): boolean => { const u = unwrap(e); return L!.isArrowFunction(u) || L!.isFunctionExpression(u) || L!.isClassExpression(u); };
const literalKey = (e: ts.Node): string | null =>
  L!.isStringLiteral(e) || L!.isNoSubstitutionTemplateLiteral(e) ? e.text : L!.isNumericLiteral(e) ? e.text : null;

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
  L!.isIdentifier(e) || L!.isNumericLiteral(e) || (L!.isParenthesizedExpression(e) && isIndexExpr(e.expression))
  || (L!.isBinaryExpression(e) && [L!.SyntaxKind.PlusToken, L!.SyntaxKind.MinusToken, L!.SyntaxKind.AsteriskToken, L!.SyntaxKind.SlashToken, L!.SyntaxKind.PercentToken].includes(e.operatorToken.kind) && isIndexExpr(e.left) && isIndexExpr(e.right));
/** Round 9 (PILOT R8-1, Skywalker N8-1): an identifier/arithmetic-keyed index read is allowed only when its VALUE provably
 *  goes nowhere it could be called: a comparison operand, a string concatenation (`+`, `+=` onto an identifier, a template
 *  span), the left of `??` / a conditional test (then judged by where that goes), the argument of a RegExp literal's
 *  `.test`, an argument of an assert method imported from node:assert, or a `const` binding whose EVERY use is one of
 *  these. Calling, constructing, indexing, member-reading, assigning to it, passing it to any other function, returning it,
 *  or storing it in a mutable binding / object / array is refused. A literal string key must also not be a banned name. */
const compareKinds = (): Set<number> => new Set([L!.SyntaxKind.EqualsEqualsEqualsToken, L!.SyntaxKind.ExclamationEqualsEqualsToken, L!.SyntaxKind.EqualsEqualsToken,
  L!.SyntaxKind.ExclamationEqualsToken, L!.SyntaxKind.LessThanToken, L!.SyntaxKind.GreaterThanToken, L!.SyntaxKind.LessThanEqualsToken,
  L!.SyntaxKind.GreaterThanEqualsToken]);
const ASSERT_METHODS = new Set(['equal', 'strictEqual', 'notEqual', 'notStrictEqual', 'deepEqual', 'deepStrictEqual', 'notDeepEqual', 'notDeepStrictEqual', 'ok']);
interface FlowCtx { readonly sf: ts.SourceFile; readonly assertNames: ReadonlySet<string>; readonly refs: ReadonlyMap<string, readonly ts.Identifier[]>; }
function valueInert(node: ts.Node, ctx: FlowCtx, depth = 0): boolean {
  if (depth > 8) return false;
  let child: ts.Node = node; let p: ts.Node = node.parent;
  while (L!.isParenthesizedExpression(p)) { child = p; p = p.parent; }
  if (L!.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (compareKinds().has(op)) return true;
    if (op === L!.SyntaxKind.PlusToken) return true; /* string/number coercion only */
    if (op === L!.SyntaxKind.PlusEqualsToken) return p.right === child && L!.isIdentifier(p.left);
    if (op === L!.SyntaxKind.QuestionQuestionToken || op === L!.SyntaxKind.BarBarToken || op === L!.SyntaxKind.AmpersandAmpersandToken) return valueInert(p, ctx, depth + 1);
    return false;
  }
  if (L!.isTemplateSpan(p)) return !L!.isTaggedTemplateExpression(p.parent.parent);
  if (L!.isConditionalExpression(p)) return p.condition === child;
  if (L!.isIfStatement(p) || L!.isWhileStatement(p)) return p.expression === child;
  if (L!.isPrefixUnaryExpression(p) && p.operator === L!.SyntaxKind.ExclamationToken) return true;
  if (L!.isCallExpression(p) && p.expression !== child && p.arguments.includes(child as ts.Expression)) {
    const c = p.expression;
    if (L!.isPropertyAccessExpression(c) && L!.idText(c.name) === 'test' && L!.isRegularExpressionLiteral(c.expression)) return true;
    if (L!.isPropertyAccessExpression(c) && L!.isIdentifier(c.expression) && ctx.assertNames.has(L!.idText(c.expression)) && ASSERT_METHODS.has(L!.idText(c.name))) return true;
    if (L!.isIdentifier(c) && ctx.assertNames.has(L!.idText(c))) return true;
    return false;
  }
  if (L!.isVariableDeclaration(p) && p.initializer === child && L!.isIdentifier(p.name)
    && L!.isVariableDeclarationList(p.parent) && (p.parent.flags & L!.NodeFlags.Const) !== 0) {
    const uses = (ctx.refs.get(L!.idText(p.name)) ?? []).filter((r) => r !== p.name);
    return uses.every((u) => valueInert(u, ctx, depth + 1));
  }
  return false;
}
/** Max nesting of ( [ { and template `${`, counted lexically (strings included: over-counting only over-refuses; a
    deliberate under-count still meets the try/catch around the parse). */
function maxDepth(src: string): number {
  let d = 0; let m = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) { d++; if (d > m) m = d; } else if ((c === 41 || c === 93 || c === 125) && d > 0) d--;
  }
  return m;
}
export function scanPinnedSourceAst(src: string): E2PinnedScanRefusal | null {
  if (Buffer.byteLength(src, 'utf8') > E2_PINNED_MAX_BYTES) return 'spec_pinned_test_too_large';
  /* Round 9 N8-2: the HTML-like comment forms are a parse differential between node (CJS script goal) and TypeScript.
     Refused anywhere, even inside a string, before parsing. Pinned files are .mjs only (the gate's
     spec_pinned_test_not_mjs), so node parses them with the module goal, the same as this parse. */
  if (src.includes('<!--') || src.includes('-->')) return 'spec_pinned_test_html_comment';
  if (maxDepth(src) > E2_PINNED_MAX_DEPTH) return 'spec_pinned_test_too_deep';
  if (loadTs() === null) return 'e2_scanner_unavailable';
  try { return scanInner(src); } catch { return 'spec_pinned_test_scan_failed'; }
}
const ASSIGN_OPS = (): ReadonlySet<ts.SyntaxKind> => new Set([L!.SyntaxKind.EqualsToken, L!.SyntaxKind.PlusEqualsToken, L!.SyntaxKind.MinusEqualsToken,
  L!.SyntaxKind.AsteriskEqualsToken, L!.SyntaxKind.AsteriskAsteriskEqualsToken, L!.SyntaxKind.SlashEqualsToken, L!.SyntaxKind.PercentEqualsToken,
  L!.SyntaxKind.LessThanLessThanEqualsToken, L!.SyntaxKind.GreaterThanGreaterThanEqualsToken, L!.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  L!.SyntaxKind.AmpersandEqualsToken, L!.SyntaxKind.BarEqualsToken, L!.SyntaxKind.CaretEqualsToken, L!.SyntaxKind.BarBarEqualsToken,
  L!.SyntaxKind.AmpersandAmpersandEqualsToken, L!.SyntaxKind.QuestionQuestionEqualsToken]);
/** Round 10: `n` is written to: the left of an assignment (also inside a destructuring pattern), a for-in/of target,
 *  a delete operand, or a ++/-- operand. */
function isWriteTarget(n: ts.Node): boolean {
  let c: ts.Node = n; const ops = ASSIGN_OPS();
  for (;;) {
    const p = c.parent;
    if (p === undefined) return false;
    if (L!.isParenthesizedExpression(p) || L!.isArrayLiteralExpression(p) || L!.isSpreadElement(p) || L!.isSpreadAssignment(p) || L!.isObjectLiteralExpression(p)
      || L!.isShorthandPropertyAssignment(p) || (L!.isPropertyAssignment(p) && p.initializer === c)) { c = p; continue; }
    if (L!.isBinaryExpression(p) && p.left === c && ops.has(p.operatorToken.kind)) return true;
    if ((L!.isForOfStatement(p) || L!.isForInStatement(p)) && p.initializer === c) return true;
    if (L!.isDeleteExpression(p)) return true;
    if ((L!.isPrefixUnaryExpression(p) || L!.isPostfixUnaryExpression(p)) && (p.operator === L!.SyntaxKind.PlusPlusToken || p.operator === L!.SyntaxKind.MinusMinusToken)) return true;
    return false;
  }
}
/** Round 10: an identifier that is a binding NAME other than the import itself (shadowing). */
function isShadowingDecl(r: ts.Identifier): boolean {
  const q = r.parent as ts.Node & { name?: ts.Node };
  return (L!.isVariableDeclaration(q) || L!.isParameter(q) || L!.isFunctionDeclaration(q) || L!.isFunctionExpression(q) || L!.isClassDeclaration(q) || L!.isClassExpression(q)
    || L!.isBindingElement(q)) && q.name === r;
}
/** Round 10: an identifier used as a property name, not as a reference to a binding. */
function isNameOnly(r: ts.Identifier): boolean {
  const q = r.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node; label?: ts.Node };
  if (L!.isImportClause(q) || L!.isImportSpecifier(q) || L!.isNamespaceImport(q)) return true;
  if (L!.isPropertyAccessExpression(q) && q.name === r) return true;
  if ((L!.isPropertyAssignment(q) || L!.isMethodDeclaration(q) || L!.isPropertyDeclaration(q) || L!.isGetAccessorDeclaration(q) || L!.isSetAccessorDeclaration(q)) && q.name === r) return true;
  if (L!.isBindingElement(q) && q.propertyName === r) return true;
  if ((L!.isLabeledStatement(q) || L!.isBreakStatement(q) || L!.isContinueStatement(q)) && q.label === r) return true;
  return false;
}
function importMutated(sf: ts.SourceFile, refs: ReadonlyMap<string, readonly ts.Identifier[]>): boolean {
  const imports = new Map<string, boolean>(); /* name -> strict (an assert/test module binding) */
  for (const st of sf.statements) {
    if (!L!.isImportDeclaration(st) || st.importClause === undefined || !L!.isStringLiteral(st.moduleSpecifier)) continue;
    const strict = /^(node:)?(assert(\/strict)?|test)$/u.test(st.moduleSpecifier.text);
    const c = st.importClause; if (c.name !== undefined) imports.set(L!.idText(c.name), strict);
    const b = c.namedBindings;
    if (b !== undefined && L!.isNamespaceImport(b)) imports.set(L!.idText(b.name), strict);
    if (b !== undefined && L!.isNamedImports(b)) for (const e of b.elements) imports.set(L!.idText(e.name), strict);
  }
  /* A `const x = <strict import>` alias is itself a strict import (checked the same way); its own declaring name is allowed. */
  const aliasDecls = new Set<ts.Identifier>();
  const queue = [...imports];
  while (queue.length > 0) {
    const [name, strict] = queue.shift() as [string, boolean];
    for (const r of refs.get(name) ?? []) {
      if (isNameOnly(r) || aliasDecls.has(r)) continue;
      if (isShadowingDecl(r)) return true;
      let top: ts.Node = r;
      for (;;) {
        const p = top.parent;
        if (p !== undefined && (L!.isParenthesizedExpression(p) || ((L!.isPropertyAccessExpression(p) || L!.isElementAccessExpression(p)) && p.expression === top))) { top = p; continue; }
        break;
      }
      if (isWriteTarget(top)) return true;
      if (strict) {
        const p = top.parent;
        const callee = p !== undefined && (L!.isCallExpression(p) || L!.isNewExpression(p)) && p.expression === top;
        const d = p;
        if (!callee && d !== undefined && L!.isVariableDeclaration(d) && d.initializer === top && top === r && L!.isIdentifier(d.name)
          && L!.isVariableDeclarationList(d.parent) && (d.parent.flags & L!.NodeFlags.Const) !== 0 && !imports.has(L!.idText(d.name))) {
          aliasDecls.add(d.name); imports.set(L!.idText(d.name), true); queue.push([L!.idText(d.name), true]); continue;
        }
        if (!callee) return true;
      }
    }
  }
  return false;
}
function scanInner(src: string): E2PinnedScanRefusal | null {
  const sf = L!.createSourceFile('pinned.mjs', src, L!.ScriptTarget.Latest, true, L!.ScriptKind.JS);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (!Array.isArray(diags) || diags.length > 0) return 'spec_pinned_test_unparsed';
  const found = new Set<E2PinnedScanRefusal>();
  const assertNames = new Set<string>(); const refs = new Map<string, ts.Identifier[]>();
  const collect = (n: ts.Node): void => {
    if (L!.isIdentifier(n)) { const t = L!.idText(n); const a = refs.get(t) ?? []; a.push(n); refs.set(t, a); }
    if (L!.isImportDeclaration(n) && L!.isStringLiteral(n.moduleSpecifier) && /^(node:)?assert(\/strict)?$/u.test(n.moduleSpecifier.text) && n.importClause !== undefined) {
      const c = n.importClause; if (c.name !== undefined) assertNames.add(L!.idText(c.name));
      const b = c.namedBindings;
      if (b !== undefined && L!.isNamespaceImport(b)) assertNames.add(L!.idText(b.name));
      if (b !== undefined && L!.isNamedImports(b)) for (const e of b.elements) { const pn = e.propertyName ?? e.name; if (L!.isIdentifier(pn) && ASSERT_METHODS.has(L!.idText(pn))) assertNames.add(L!.idText(e.name)); }
    }
    L!.forEachChild(n, collect);
  };
  collect(sf);
  for (const name of [...assertNames]) {
    const declared = (refs.get(name) ?? []).some((r) => { const q = r.parent; return (L!.isVariableDeclaration(q) || L!.isParameter(q) || L!.isFunctionDeclaration(q) || L!.isClassDeclaration(q) || L!.isBindingElement(q)) && (q as { name?: ts.Node }).name === r; });
    if (declared) assertNames.delete(name);
  }
  const ctx: FlowCtx = { sf, assertNames, refs };
  if (/NODE_TEST_/u.test(src)) found.add('spec_pinned_test_context_reference');
  const dyn = (): void => { found.add('spec_pinned_test_dynamic_load'); };
  const loadSpec = (spec: ts.Node | undefined): void => {
    const s = spec === undefined ? null : literalKey(spec);
    if (s === null || L!.isNumericLiteral(spec as ts.Node)) dyn();
    else if (!E2_PINNED_IMPORT_ALLOWLIST.has(s)) found.add('spec_pinned_test_imports_untrusted');
  };
  const visit = (n: ts.Node): void => {
    if (L!.isIdentifier(n) || L!.isPrivateIdentifier(n)) {
      const name = L!.isIdentifier(n) ? L!.idText(n) : n.text;
      if (n.getText(sf) !== name) dyn(); /* written with a unicode escape */
      if (E2_PINNED_BANNED_NAMES.has(name.replace(/^#/u, ''))) dyn();
      if (name === 'require') {
        const p = n.parent;
        const ok = L!.isCallExpression(p) && p.expression === n && p.arguments.length === 1;
        if (!ok) dyn(); else loadSpec(p.arguments[0]);
      }
    }
    if (L!.isImportDeclaration(n) || (L!.isExportDeclaration(n) && n.moduleSpecifier !== undefined)) loadSpec(n.moduleSpecifier);
    if (L!.isImportEqualsDeclaration(n) || L!.isWithStatement(n) || L!.isTaggedTemplateExpression(n)) dyn();
    if (L!.isCallExpression(n) && n.expression.kind === L!.SyntaxKind.ImportKeyword) dyn();
    if (L!.isMetaProperty(n) && n.keywordToken === L!.SyntaxKind.ImportKeyword) {
      if (!(L!.isPropertyAccessExpression(n.parent) && n.parent.expression === n && META_OK.has(L!.idText(n.parent.name as ts.Identifier)))) dyn();
    }
    /* Round 9 N8-1: no member or index access on a function, arrow or class expression, and no foldable string naming
       the prototype route anywhere (a literal, a concatenation or a template, in any position). */
    if ((L!.isElementAccessExpression(n) || L!.isPropertyAccessExpression(n)) && isFunctionLike(n.expression)) dyn();
    if (L!.isStringLiteral(n) || L!.isNoSubstitutionTemplateLiteral(n) || L!.isTemplateExpression(n) || (L!.isBinaryExpression(n) && n.operatorToken.kind === L!.SyntaxKind.PlusToken)) {
      const v = foldString(n); if (v !== null && (E2_PINNED_BANNED_STRINGS.has(v) || E2_PINNED_BANNED_STRINGS.has(v.replace(/^node:/u, '')))) dyn();
    }
    if (L!.isElementAccessExpression(n)) {
      const k = literalKey(n.argumentExpression);
      if (k === null) {
        if (!isIndexExpr(n.argumentExpression) || !valueInert(n, ctx)) dyn();
        const obj = n.expression;
        if ((L!.isIdentifier(obj) && obj.text === 'env') || (L!.isPropertyAccessExpression(obj) && L!.idText(obj.name as ts.Identifier) === 'env')
          || (L!.isElementAccessExpression(obj) && literalKey(obj.argumentExpression) === 'env')) found.add('spec_pinned_test_context_reference');
      } else if (E2_PINNED_BANNED_NAMES.has(k) || k === 'require') dyn();
    }
    if (L!.isComputedPropertyName(n)) {
      const k = literalKey(n.expression);
      if (k === null || E2_PINNED_BANNED_NAMES.has(k) || k === 'require') dyn();
    }
    if ((L!.isStringLiteral(n) || L!.isNumericLiteral(n) || L!.isNoSubstitutionTemplateLiteral(n)) && n.parent !== undefined) {
      const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
      if ((p.name === n || p.propertyName === n) && (E2_PINNED_BANNED_NAMES.has(n.text) || n.text === 'require')) dyn();
    }
    L!.forEachChild(n, visit);
  };
  visit(sf);
  for (const r of ['spec_pinned_test_context_reference', 'spec_pinned_test_imports_untrusted', 'spec_pinned_test_dynamic_load'] as const) if (found.has(r)) return r;
  /* Round 10 F9-3: checked last, so every earlier refusal keeps its code. */
  if (importMutated(sf, refs)) return 'spec_pinned_test_import_mutated';
  return null;
}
