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
