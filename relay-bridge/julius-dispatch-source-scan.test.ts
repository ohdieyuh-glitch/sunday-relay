import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkHostedRunnerDynamicImports, closureOf, HOSTED_RUNNER_ALLOWED_SPECIFIER, scanSource, type ScanIo } from './julius-dispatch-source-scan';

/* M3 D3: the wiring source scan must see .js-suffixed specifiers, index files and dynamic import() with a string literal, and a
   non-literal dynamic import in the closure is a failure. The scan itself is under test here, with MUTANTS (the old scan). */

const norm = (p: string): string => p.replace(/\\/gu, '/').replace(/^[A-Za-z]:/u, '');
const fakeIo = (files: Record<string, string>): ScanIo => ({
  read: (p) => { const v = files[norm(p)]; if (v === undefined) throw new Error(`enoent ${p}`); return v; },
  exists: (p) => norm(p) in files,
});
const KIT = '/x/julius-dispatch-wiring-testkit.ts';
const TESTKIT = /wiring-testkit/u;

/** Each case is a fake closure that DOES reach the test kit by one route; a scan that does not report it MISSED the route. */
const CASES: Record<string, Record<string, string>> = {
  'js-suffixed specifier': { '/x/server.ts': "import { a } from './mid.js';", '/x/mid.ts': "export { k } from './julius-dispatch-wiring-testkit.js';", [KIT]: 'export const k = 1;' },
  'index file': { '/x/server.ts': "import { a } from './dir';", '/x/dir/index.ts': "import './../julius-dispatch-wiring-testkit';", [KIT]: 'export const k = 1;' },
  'dynamic import with a string literal': { '/x/server.ts': "const m = await import('./julius-dispatch-wiring-testkit');", [KIT]: 'export const k = 1;' },
  'require with a string literal': { '/x/server.ts': "const m = require('./julius-dispatch-wiring-testkit');", [KIT]: 'export const k = 1;' },
  'side-effect import': { '/x/server.ts': "import './julius-dispatch-wiring-testkit';", [KIT]: 'export const k = 1;' },
};
const NONLITERAL = { '/x/server.ts': 'const n = "./julius-dispatch-wiring-" + "testkit"; await import(n);' };

type Scan = (files: Record<string, string>) => { files: string[]; nonLiteralDynamic: string[] };
const real: Scan = (files) => closureOf(['/x/server.ts'], fakeIo(files));

/** The GUARD as a predicate: returns the routes the scan MISSED. */
function missedRoutes(scan: Scan): string[] {
  const missed: string[] = [];
  for (const [name, files] of Object.entries(CASES)) if (!scan(files).files.some((f) => TESTKIT.test(norm(f)))) missed.push(name);
  if (scan(NONLITERAL).nonLiteralDynamic.length === 0) missed.push('non-literal dynamic import');
  return missed;
}

/** The OLD scan (M3 caveat): static `from`/`import` only, resolving `.ts` and `/index.ts` only. */
const legacyScan: Scan = (files) => {
  const io = fakeIo(files);
  const importsOf = (file: string): string[] => {
    const out: string[] = [];
    for (const m of io.read(file).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) {
      const base = resolve(dirname(file), m[1]!);
      for (const cand of [`${base}.ts`, join(base, 'index.ts'), base]) if (io.exists(cand) && /\.ts$/u.test(cand)) { out.push(cand); break; }
    }
    return out;
  };
  const seen = new Set<string>();
  const queue = ['/x/server.ts'];
  while (queue.length > 0) { const f = queue.pop()!; if (seen.has(f)) continue; seen.add(f); queue.push(...importsOf(f)); }
  return { files: [...seen], nonLiteralDynamic: [] };
};

describe('D3 the source scan resolves every import route', () => {
  it('scanSource reads static, re-export, side-effect, require and literal dynamic specifiers; flags a non-literal dynamic import; ignores comments', () => {
    const src = [
      "import a from './a.js';", "import type { T } from '../b';", "export * from './c';", "import './d';", "const e = require('./e');",
      "const f = await import('./f');", "const g = await import(`./g`);", "// import('./commented');", '/* import("./blocked"); */',
      'this.require(id); const h = await import(name);', 'const i = await import(`./x/${n}`);',
    ].join('\n');
    const r = scanSource(src);
    expect([...r.specifiers].sort()).toEqual(['../b', './a.js', './c', './d', './e', './f', './g']);
    expect(r.nonLiteralDynamic).toBe(2);
  });
  it('the real scan reports the test kit by EVERY route and flags the non-literal dynamic import', () => {
    expect(missedRoutes(real)).toEqual([]);
  });
  it('MUTANT: the old scan misses the .js-suffixed, require and non-literal routes (so the guard test would fail against it)', () => {
    expect(missedRoutes(legacyScan)).toEqual(['js-suffixed specifier', 'require with a string literal', 'non-literal dynamic import']);
  });
  it('an unresolvable relative specifier is reported (it cannot be proven clean)', () => {
    const r = closureOf(['/x/server.ts'], fakeIo({ '/x/server.ts': "import './nowhere';" }));
    expect(r.unresolved).toEqual([{ from: '/x/server.ts', spec: './nowhere' }]);
  });
});

/* R1: the ONE non-literal dynamic import (hosted-runner.ts) is allowed by its EXACT shape and specifier constant, not by file name. */
describe('R1 the hosted-runner dynamic import allowance is tied to the exact specifier', () => {
  const readFile = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
  const runnerText = readFile('hosted-coding-agent/hosted-runner.ts');
  const readinessText = readFile('hosted-coding-agent/hosted-readiness.ts');
  const check = (runner: string, readiness: string = readinessText): readonly string[] => checkHostedRunnerDynamicImports(runner, readiness);
  const SITE = "const dynamicImport = new Function('id', 'return import(id)') as (id: string) => Promise<unknown>;\n  const mod = await dynamicImport(HOSTED_SDK_PACKAGE) as { query?: unknown };";

  it('the real file text passes: two exact sites, both loading the constant, which is the exact SDK package string', () => {
    expect(HOSTED_RUNNER_ALLOWED_SPECIFIER).toBe('@anthropic-ai/claude-agent-sdk');
    expect(check(runnerText)).toEqual([]);
  });
  it('MUTANT: a second NON-literal dynamic import added to the file fails', () => {
    expect(check(`${runnerText}\nexport const x = async (n: string) => import(n);`)).not.toEqual([]);
  });
  it('MUTANT: a second LITERAL dynamic import added to the file fails', () => {
    expect(check(`${runnerText}\nexport const y = async () => import('node:child_process');`)).not.toEqual([]);
  });
  it('MUTANT: a second Function-wrapped import site (even loading the same constant) fails', () => {
    expect(check(`${runnerText}\n${SITE}`)).not.toEqual([]);
  });
  it('MUTANT: a changed specifier at the call site fails (literal, other identifier)', () => {
    expect(check(runnerText.replace('await dynamicImport(HOSTED_SDK_PACKAGE) as { query', "await dynamicImport('evil-package') as { query"))).not.toEqual([]);
    expect(check(runnerText.replace('await dynamicImport(HOSTED_SDK_PACKAGE) as { query', 'await dynamicImport(process.env.X as string) as { query'))).not.toEqual([]);
  });
  it('MUTANT: a changed constant value in hosted-readiness fails; an eval or a different Function body fails', () => {
    expect(check(runnerText, readinessText.replace("'@anthropic-ai/claude-agent-sdk'", "'@evil/sdk'"))).not.toEqual([]);
    expect(check(`${runnerText}\nconst z = eval('1');`)).not.toEqual([]);
    expect(check(runnerText.replace("'return import(id)'", "'return import(id + \"/x\")'"))).not.toEqual([]);
  });
  it('the allowance does not extend to any other file: the generic scan still counts the non-literal import', () => {
    expect(scanSource(runnerText).nonLiteralDynamic).toBeGreaterThan(0);
  });
});
