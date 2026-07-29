import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Browser/Node dependency boundary — the structural guard for the collision
 * that blocked the post-separation integration.
 *
 * Before the seam existed, `src/relay/ui/data.ts` imported the CLI's
 * `competitive.ts` for its mission projection. That single edge pulled
 * `cli/render.ts` → `cli/product/**` → `persistence/**` → `node:fs`/`node:os`/
 * `node:path` into the browser bundle, and `vite build` failed on
 * `"resolve" is not exported by "__vite-browser-external"`.
 *
 * This test walks the STATIC import graph from every browser entry and fails
 * if any of them can reach a CLI module, a persistence implementation, or a
 * Node built-in. It is deliberately a source-level graph walk rather than a
 * build assertion: it names the exact offending edge, and it fails in `npm
 * test` long before anyone waits on a bundler.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const relayRoot = join(ROOT, 'src', 'relay');

/** Every entry that is loaded by a browser. */
const BROWSER_ENTRIES = ['src/relay/main.tsx'];

/** Directories a browser entry must never reach. */
const FORBIDDEN_DIRS = [
  { prefix: 'src/relay/cli/', why: 'the CLI/terminal surface' },
  { prefix: 'src/relay/persistence/', why: 'the Node durable-persistence implementation' },
];

/** Node built-ins a browser entry must never reach, in any spelling. */
const FORBIDDEN_BUILTINS = [
  'node:path', 'path',
  'node:fs', 'fs', 'node:fs/promises', 'fs/promises',
  'node:child_process', 'child_process',
  'node:os', 'os',
  'node:crypto', 'crypto',
  'node:process', 'node:worker_threads', 'node:net', 'node:http', 'node:https',
];

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '/index.ts', '/index.tsx'];

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module specifier in a source file: static imports, re-exports, side
 * effect imports and dynamic `import(...)` with a literal specifier. */
function specifiersOf(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) found.add(m[1]);
  }
  return [...found];
}

interface Violation { chain: string[]; offender: string; why: string }

/** Walk the static import graph from `entry`, returning every violation with
 * the full chain that reaches it, so a failure names the edge to cut. */
function walk(entry: string): { modules: Set<string>; violations: Violation[] } {
  const entryAbs = resolve(ROOT, entry);
  const parent = new Map<string, string>();
  const modules = new Set<string>([entryAbs]);
  const violations: Violation[] = [];
  const queue = [entryAbs];

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    let cur: string | undefined = file;
    while (cur) { chain.unshift(relative(ROOT, cur)); cur = parent.get(cur); }
    return chain;
  };

  while (queue.length) {
    const file = queue.shift()!;
    let source: string;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }

    for (const spec of specifiersOf(source)) {
      if (FORBIDDEN_BUILTINS.includes(spec)) {
        violations.push({ chain: chainTo(file), offender: spec, why: 'a Node built-in' });
        continue;
      }
      if (!spec.startsWith('.')) continue;   // npm package — not our boundary
      if (/\.css$/.test(spec)) continue;     // stylesheets carry no code

      const next = resolveRelative(file, spec);
      if (!next) continue;
      const rel = relative(ROOT, next);
      const forbidden = FORBIDDEN_DIRS.find((d) => rel.startsWith(d.prefix));
      if (forbidden) {
        parent.set(next, file);
        violations.push({ chain: chainTo(next), offender: rel, why: forbidden.why });
        continue;                            // report the edge, don't recurse into it
      }
      if (modules.has(next)) continue;
      modules.add(next);
      parent.set(next, file);
      queue.push(next);
    }
  }
  return { modules, violations };
}

const format = (v: Violation) => `\n  reaches ${v.offender} (${v.why}) via:\n    ${v.chain.join('\n    → ')}`;

describe('browser/Node dependency boundary', () => {
  for (const entry of BROWSER_ENTRIES) {
    describe(entry, () => {
      const { modules, violations } = walk(entry);

      it('resolves a real, non-trivial browser graph', () => {
        expect(existsSync(resolve(ROOT, entry)), `${entry} must exist`).toBe(true);
        expect(modules.size).toBeGreaterThan(20);
      });

      it('cannot reach src/relay/cli', () => {
        const hits = violations.filter((v) => v.offender.startsWith('src/relay/cli/'));
        expect(hits.map(format).join(''), 'browser entry reached the CLI surface').toBe('');
      });

      it('cannot reach the Node persistence implementation', () => {
        const hits = violations.filter((v) => v.offender.startsWith('src/relay/persistence/'));
        expect(hits.map(format).join(''), 'browser entry reached Node persistence').toBe('');
      });

      it('cannot reach node:path', () => {
        const hits = violations.filter((v) => v.offender === 'node:path' || v.offender === 'path');
        expect(hits.map(format).join('')).toBe('');
      });

      it('cannot reach node:fs', () => {
        const hits = violations.filter((v) => /^(node:)?fs(\/promises)?$/.test(v.offender));
        expect(hits.map(format).join('')).toBe('');
      });

      it('cannot reach child_process', () => {
        const hits = violations.filter((v) => /^(node:)?child_process$/.test(v.offender));
        expect(hits.map(format).join('')).toBe('');
      });

      it('cannot reach any Node built-in at all', () => {
        const hits = violations.filter((v) => v.why === 'a Node built-in');
        expect(hits.map(format).join('')).toBe('');
      });
    });
  }

  it('the shared seam is itself browser safe', () => {
    const { violations } = walk('src/relay/shared/index.ts');
    expect(violations.map(format).join(''), 'src/relay/shared must stay browser safe').toBe('');
  });

  it('the CLI may consume the shared seam', () => {
    // The boundary is one-directional: the browser must not reach the CLI, but
    // the CLI is free to import the shared domain — that is the whole point of
    // having one projection behind two renderers.
    const competitive = readFileSync(join(relayRoot, 'cli', 'competitive.ts'), 'utf8');
    expect(competitive).toContain("from '../shared/competitive-mission'");
  });

  it('the website takes its mission projection from shared, not from the CLI', () => {
    const data = readFileSync(join(relayRoot, 'ui', 'data.ts'), 'utf8');
    expect(data).toContain("from '../shared/competitive-mission'");
    expect(data).not.toContain("from '../cli/");
  });

  it('no file under src/relay/ui imports src/relay/cli', () => {
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const name of require('node:fs').readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { visit(full); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const src = readFileSync(full, 'utf8');
        for (const spec of specifiersOf(src)) {
          if (!spec.startsWith('.')) continue;
          const target = resolveRelative(full, spec);
          if (target && relative(ROOT, target).startsWith('src/relay/cli/')) {
            offenders.push(`${relative(ROOT, full)} → ${spec}`);
          }
        }
      }
    };
    visit(join(relayRoot, 'ui'));
    expect(offenders).toEqual([]);
  });
});
