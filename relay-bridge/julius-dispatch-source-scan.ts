import { dirname, join, resolve } from 'node:path';

/**
 * TEST SUPPORT ONLY (imported by tests; nothing in the production closure imports it). The import-closure scan behind the C1 source-scan
 * tests in julius-dispatch-wiring.test.ts. Pure over an injected file reader.
 *
 * It resolves: `from '...'`, side-effect `import '...'`, `export ... from '...'`, `require('...')` and `import('...')` with a string literal
 * (or a template literal with no substitution); specifiers with a `.js`/`.mjs`/`.cjs` suffix (resolved to the `.ts` source); a directory's
 * `index.ts`. A DYNAMIC import with a non-literal argument cannot be followed and is reported (`nonLiteralDynamic`); a relative specifier
 * that resolves to nothing is reported (`unresolved`). Both are failures for the caller: a closure that cannot be proven is not clean.
 */

export interface ScanIo { read(path: string): string; exists(path: string): boolean }

export interface SourceScan { readonly specifiers: readonly string[]; readonly nonLiteralDynamic: number }

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, ' ').split(/\r?\n/u).map((l) => l.replace(/(^|\s)\/\/.*$/u, '$1')).join('\n');
}

export function scanSource(source: string): SourceScan {
  const src = stripComments(source);
  const specs = new Set<string>();
  for (const m of src.matchAll(/\b(?:from|import)\s*(['"])([^'"\n]+)\1/gu)) specs.add(m[2]!);
  for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*(['"`])([^'"`\n$]+)\1\s*\)/gu)) specs.add(m[2]!);
  let nonLiteral = 0;
  for (const m of src.matchAll(/(?<![.\w$])(?<!\b(?:private|public|protected|static|async|function|get|set)\s+)(?:import|require)\s*\(([^)]*)/gu)) if (!/^\s*(['"`])[^'"`\n$]*\1\s*$/u.test(m[1]!)) nonLiteral += 1;
  return { specifiers: [...specs], nonLiteralDynamic: nonLiteral };
}

export function resolveSpecifier(fromFile: string, spec: string, io: ScanIo): string | null {
  if (!/^\.{1,2}\//u.test(spec)) return null;
  const base = resolve(dirname(fromFile), spec);
  const stem = base.replace(/\.(?:m|c)?js$/u, '');
  const candidates = [`${base}.ts`, `${base}.tsx`, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base];
  for (const cand of candidates) if (io.exists(cand)) return cand;
  return null;
}

export interface Closure {
  readonly files: string[];
  readonly unresolved: { readonly from: string; readonly spec: string }[];
  readonly nonLiteralDynamic: string[];
}

/** Every TypeScript source file reachable from `start` (test files are not followed). Non-TS leaves (json, mjs) are resolved but not read. */
export function closureOf(start: readonly string[], io: ScanIo): Closure {
  const seen = new Set<string>();
  const unresolved: { from: string; spec: string }[] = [];
  const nonLiteralDynamic: string[] = [];
  const queue = [...start];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f) || /\.test\.ts$/u.test(f)) continue;
    seen.add(f);
    if (!/\.tsx?$/u.test(f)) continue;
    const scan = scanSource(io.read(f));
    if (scan.nonLiteralDynamic > 0) nonLiteralDynamic.push(f);
    for (const spec of scan.specifiers) {
      if (!/^\.{1,2}\//u.test(spec)) continue;
      const target = resolveSpecifier(f, spec, io);
      if (target === null) unresolved.push({ from: f, spec }); else queue.push(target);
    }
  }
  return { files: [...seen], unresolved, nonLiteralDynamic };
}

/** The ONLY specifier the hosted runner may load through its Function-wrapped dynamic import. */
export const HOSTED_RUNNER_ALLOWED_SPECIFIER = '@anthropic-ai/claude-agent-sdk';
/** The exact number of call sites in hosted-runner.ts (loadHostedQuery, loadHostedSdkHelpers). */
const HOSTED_RUNNER_SITES = 2;

/**
 * R1 NAMED ALLOWANCE, tied to the call site and not to the file. Returns the problems (empty = the file is exactly the known shape):
 * the comment-stripped runner text must contain exactly {@link HOSTED_RUNNER_SITES} occurrences of `new Function('id', 'return import(id)')`
 * and no other `import(`, `eval(` or `new Function(`; every call of the wrapped function must pass exactly `HOSTED_SDK_PACKAGE` and there
 * must be one such call per site; and hosted-readiness.ts must define `HOSTED_SDK_PACKAGE` as exactly the allowed specifier string.
 */
export function checkHostedRunnerDynamicImports(runnerSource: string, readinessSource: string): readonly string[] {
  const problems: string[] = [];
  const src = stripComments(runnerSource);
  const siteRe = /new Function\(\s*'id'\s*,\s*'return import\(id\)'\s*\)/gu;
  const sites = [...src.matchAll(siteRe)].length;
  if (sites !== HOSTED_RUNNER_SITES) problems.push(`expected ${HOSTED_RUNNER_SITES} Function-wrapped import sites, found ${sites}`);
  const withoutSites = src.replace(siteRe, ' ');
  const other = [...withoutSites.matchAll(/(?<![.\w$])import\s*\(/gu)].length;
  if (other > 0) problems.push(`${other} other dynamic import call(s)`);
  if (/(?<![.\w$])eval\s*\(/u.test(src)) problems.push('eval call');
  if ([...src.matchAll(/new Function\s*\(/gu)].length !== sites) problems.push('a Function constructor that is not the exact allowed shape');
  const vars = [...src.matchAll(/const\s+(\w+)\s*=\s*new Function\(\s*'id'\s*,\s*'return import\(id\)'\s*\)/gu)].map((m) => m[1]!);
  if (vars.length !== sites || new Set(vars).size !== 1) problems.push('the wrapped function is not bound to one name');
  else {
    const name = vars[0]!;
    const calls = [...withoutSites.matchAll(new RegExp(String.raw`(?<![.\w$])` + name + String.raw`[ \t]*[(]([^)]*)[)]`, 'gu'))].map((m) => m[1]!.trim());
    if (calls.length !== sites) problems.push(`expected ${sites} calls of ${name}, found ${calls.length}`);
    for (const arg of calls) if (arg !== 'HOSTED_SDK_PACKAGE') problems.push(`call passes "${arg}", not HOSTED_SDK_PACKAGE`);
  }
  if (!/import\s*\{[^}]*\bHOSTED_SDK_PACKAGE\b[^}]*\}\s*from\s*'\.\/hosted-readiness'/u.test(src)) problems.push('HOSTED_SDK_PACKAGE is not imported from ./hosted-readiness');
  const defs = [...stripComments(readinessSource).matchAll(/export const HOSTED_SDK_PACKAGE\s*=\s*(['"`])([^'"`]*)\1\s*;/gu)];
  if (defs.length !== 1 || defs[0]![2] !== HOSTED_RUNNER_ALLOWED_SPECIFIER) problems.push('HOSTED_SDK_PACKAGE is not exactly the allowed specifier');
  return problems;
}
