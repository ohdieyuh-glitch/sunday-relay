import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
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
 * This test walks the module graph from every browser entry and fails if any
 * of them can reach a server-only module or a Node built-in. It is
 * deliberately a source-level graph walk rather than a build assertion: it
 * names the exact offending edge, and it fails in `npm test` long before
 * anyone waits on a bundler.
 *
 * WHY IT WAS STRENGTHENED (H-3). The previous walker recognised only four
 * import forms and two forbidden directories, so the boundary could be
 * stepped around rather than broken:
 *
 *   - a root-absolute `/src/relay/cli/render` import resolved for the bundler
 *     but not for the guard, which only followed specifiers starting `.`;
 *   - `.mjs`, `.cjs`, `.mts` and `.cts` modules were invisible: they were not
 *     in the resolver's extension list, so an edge through one vanished;
 *   - `import.meta.glob`, `new Worker(new URL(…, import.meta.url))` and
 *     template-literal dynamic imports were not scanned at all;
 *   - only `cli/` and `persistence/` were forbidden, so the filesystem
 *     executor, the worktree manager, the git-shelling YC preflight, the
 *     bridge server and the provider connectors were all reachable without
 *     the guard objecting.
 *
 * Every recognised form now has an adversarial fixture below that PROVES the
 * walker catches it, built in a temporary tree so the real repository is
 * never polluted with a deliberately-broken module.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const relayRoot = join(ROOT, 'src', 'relay');

/** Every entry that is loaded by a browser. */
const BROWSER_ENTRIES = ['src/relay/main.tsx'];

/* ------------------------------------------------------------ policy */

interface ForbiddenDir {
  prefix: string;
  why: string;
  /** Modules inside the prefix that are genuinely browser safe. */
  allow?: readonly string[];
}

/**
 * PURE CONNECTOR CONTRACTS.
 *
 * `src/relay/connectors/` holds provider runtimes — Claude Code, the Codex
 * reviewer and the supervised loop all spawn processes and read the
 * filesystem — so the directory as a whole is server-only. Two modules in it
 * are not:
 *
 *   ports.ts      port TYPES only; every import in it is `import type`, so it
 *                 contributes no runtime code to any bundle;
 *   simulated.ts  the deterministic in-memory simulation the browser console
 *                 runs on. Every output is hard-stamped `provenance:
 *                 'simulated'`; it starts no process, opens no socket and
 *                 reads no file.
 *
 * These are allowlisted rather than assumed: `the allowlisted connector
 * contracts are genuinely pure` below re-derives their purity from source, so
 * the allowance cannot rot into a laundering channel for the runtimes.
 */
const PURE_CONNECTOR_CONTRACTS = [
  'src/relay/connectors/ports.ts',
  'src/relay/connectors/simulated.ts',
] as const;

/** Directories a browser entry must never reach. */
const FORBIDDEN_DIRS: readonly ForbiddenDir[] = [
  { prefix: 'src/relay/cli/', why: 'the CLI/terminal surface' },
  {
    prefix: 'src/relay/persistence/',
    why: 'the Node durable-persistence implementation — journals, snapshots and locks on disk',
  },
  {
    prefix: 'src/relay/workspace/',
    why: 'filesystem execution — worktree management, repository inspection and command running',
  },
  { prefix: 'src/relay/yc/', why: 'the YC preflight, which shells out to git' },
  {
    prefix: 'src/relay/connectors/',
    why: 'provider connectors and server-only adapters',
    allow: PURE_CONNECTOR_CONTRACTS,
  },
  {
    prefix: 'src/relay/testing/',
    why: 'the deterministic TEST FIXTURE surface — deterministicIds and testClock exist for tests, and a browser edge into them ships the whole fixture module in the product bundle',
  },
  { prefix: 'relay-bridge/', why: 'the local Relay bridge SERVER' },
  { prefix: 'scripts/', why: 'repository tooling — boundary, parity and deployment scanners' },
];

/**
 * Node built-ins a browser entry must never reach, in ANY spelling. Taken
 * from the runtime's own list rather than a hand-maintained subset, so a
 * built-in nobody thought of is covered the day it is used.
 */
const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

/** Module file extensions the resolver understands. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Resolution order: exact, then extension, then directory index. */
const RESOLVE_EXTS = [
  '',
  ...SOURCE_EXTENSIONS,
  ...SOURCE_EXTENSIONS.map((ext) => `/index${ext}`),
];

/* ---------------------------------------------------------- resolving */

/**
 * Aliases configured for the build. There are currently NONE — and the guard
 * says so out loud rather than silently supporting a feature nobody uses:
 * `no unguarded module alias is configured` fails the moment one appears, so
 * an alias can never route around this walk unnoticed.
 */
function configuredAliases(root: string): Array<{ from: string; to: string }> {
  const aliases: Array<{ from: string; to: string }> = [];
  const tsconfigPath = join(root, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const raw = readFileSync(tsconfigPath, 'utf8').replace(/\/\/[^\n]*/g, '');
    const parsed = JSON.parse(raw) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const base = parsed.compilerOptions?.baseUrl ?? '.';
    for (const [pattern, targets] of Object.entries(parsed.compilerOptions?.paths ?? {})) {
      const target = targets[0];
      if (typeof target !== 'string') continue;
      aliases.push({
        from: pattern.replace(/\*$/, ''),
        to: join(root, base, target.replace(/\*$/, '')),
      });
    }
  }
  return aliases;
}

function resolveSpecifier(
  root: string,
  fromFile: string,
  spec: string,
  aliases: Array<{ from: string; to: string }>,
): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else if (spec.startsWith('/')) {
    // Root-absolute: the bundler resolves it from the project root, and so
    // must this guard — otherwise `/src/relay/cli/render` is invisible here.
    base = resolve(root, `.${spec}`);
  } else {
    const alias = aliases.find((a) => a.from !== '' && spec.startsWith(a.from));
    if (alias) base = resolve(alias.to, spec.slice(alias.from.length));
  }
  if (base === null) return null;

  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/* --------------------------------------------------------- specifiers */

interface Specifier {
  spec: string;
  /** How the specifier was written — reported so a failure names the form. */
  form: string;
}

/** `**` → any depth, `*` → one segment, `?` → one character. */
function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function listFilesUnder(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFilesUnder(full));
    else out.push(full);
  }
  return out;
}

/** Files an `import.meta.glob` pattern actually matches on disk. */
function resolveGlob(root: string, fromFile: string, pattern: string): string[] {
  const base = pattern.startsWith('/')
    ? resolve(root, `.${pattern}`)
    : resolve(dirname(fromFile), pattern);
  const wildcardAt = base.search(/[*?]/);
  const searchRoot = wildcardAt < 0 ? dirname(base) : dirname(base.slice(0, wildcardAt));
  const matcher = globToRegExp(base);
  return listFilesUnder(searchRoot).filter((file) => matcher.test(file));
}

/**
 * Every module specifier in a source file. The forms are enumerated
 * explicitly so a failure can say WHICH form carried the edge, and so that
 * adding a form is a visible change to this list rather than a silent gap.
 */
function specifiersOf(source: string): Specifier[] {
  const found = new Map<string, string>();
  const add = (spec: string, form: string) => {
    if (spec && !found.has(spec)) found.set(spec, form);
  };

  const patterns: Array<[RegExp, string]> = [
    // `import x from 'y'`, `import type {…} from 'y'`, `import 'y'`,
    // `export * from 'y'`, `export {…} from 'y'`
    [/(?:^|[\s;})])(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, 'static import / export-from'],
    // `import('y')` and `import(`y`)` with a fully static template literal
    [/\bimport\s*\(\s*'([^']+)'\s*\)/g, 'dynamic import'],
    [/\bimport\s*\(\s*"([^"]+)"\s*\)/g, 'dynamic import'],
    [/\bimport\s*\(\s*`([^`$]+)`\s*\)/g, 'dynamic import (template literal)'],
    [/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'require'],
    // `new Worker(new URL('./w.ts', import.meta.url))` and the bare URL form
    [/new\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"`]([^'"`]+)['"`]/g, 'new Worker(new URL(…, import.meta.url))'],
    [/new\s+URL\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*import\.meta\.url\s*\)/g, 'new URL(…, import.meta.url)'],
  ];

  for (const [re, form] of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source))) add(match[1], form);
  }
  return [...found].map(([spec, form]) => ({ spec, form }));
}

/** `import.meta.glob('…')` patterns, which expand to many modules. */
function globPatternsOf(source: string): string[] {
  const out: string[] = [];
  const re = /\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.push(match[1]);
  return out;
}

/**
 * Dynamic imports whose specifier is INTERPOLATED, e.g. ``import(`./${name}`)``.
 * They cannot be resolved statically, so they are reported rather than
 * ignored: an unanalyzable edge in a browser module is a hole in this guard,
 * not an absence of one.
 */
function unanalyzableDynamicImports(source: string): string[] {
  const out: string[] = [];
  const re = /\bimport\s*\(\s*(`[^`]*\$\{[^`]*`|[A-Za-z_$][\w$]*)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.push(match[1]);
  return out;
}

/* -------------------------------------------------------------- walk */

interface Violation {
  chain: string[];
  offender: string;
  why: string;
  form: string;
}

interface WalkResult {
  modules: Set<string>;
  violations: Violation[];
}

interface WalkOptions {
  root: string;
  entry: string;
  forbidden?: readonly ForbiddenDir[];
  builtins?: ReadonlySet<string>;
}

/** Walk the module graph from `entry`, returning every violation with the
 * full chain that reaches it, so a failure names the edge to cut. */
function walk(options: WalkOptions): WalkResult {
  const { root, entry } = options;
  const forbidden = options.forbidden ?? FORBIDDEN_DIRS;
  const builtins = options.builtins ?? NODE_BUILTINS;
  const aliases = configuredAliases(root);

  const entryAbs = resolve(root, entry);
  const parent = new Map<string, string>();
  const modules = new Set<string>([entryAbs]);
  const violations: Violation[] = [];
  const queue = [entryAbs];

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    let cur: string | undefined = file;
    while (cur) {
      chain.unshift(relative(root, cur));
      cur = parent.get(cur);
    }
    return chain;
  };

  const forbiddenFor = (rel: string): ForbiddenDir | undefined =>
    forbidden.find((d) => rel.startsWith(d.prefix) && !(d.allow ?? []).includes(rel));

  while (queue.length) {
    const file = queue.shift()!;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const interpolated of unanalyzableDynamicImports(source)) {
      violations.push({
        chain: chainTo(file),
        offender: interpolated,
        why: 'a dynamic import this guard cannot resolve statically',
        form: 'dynamic import (interpolated)',
      });
    }

    const edges: Specifier[] = [...specifiersOf(source)];
    for (const pattern of globPatternsOf(source)) {
      for (const matched of resolveGlob(root, file, pattern)) {
        edges.push({ spec: `./${relative(dirname(file), matched)}`, form: `import.meta.glob('${pattern}')` });
      }
    }

    for (const { spec, form } of edges) {
      if (builtins.has(spec)) {
        violations.push({ chain: chainTo(file), offender: spec, why: 'a Node built-in', form });
        continue;
      }
      if (/\.(css|svg|png|jpe?g|webp|woff2?)$/.test(spec)) continue; // assets carry no code

      const next = resolveSpecifier(root, file, spec, aliases);
      if (next === null) continue; // an npm package — not our boundary
      const rel = relative(root, next);
      const hit = forbiddenFor(rel);
      if (hit) {
        parent.set(next, file);
        violations.push({ chain: chainTo(next), offender: rel, why: hit.why, form });
        continue; // report the edge, don't recurse into it
      }
      if (modules.has(next)) continue;
      modules.add(next);
      parent.set(next, file);
      queue.push(next);
    }
  }
  return { modules, violations };
}

const format = (v: Violation) =>
  `\n  reaches ${v.offender} (${v.why})\n  via ${v.form}:\n    ${v.chain.join('\n    → ')}`;

/* =================================================== the real product */

describe('browser/Node dependency boundary', () => {
  for (const entry of BROWSER_ENTRIES) {
    describe(entry, () => {
      const { modules, violations } = walk({ root: ROOT, entry });

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

      it('cannot reach filesystem execution, worktrees or the git-shelling preflight', () => {
        const hits = violations.filter(
          (v) => v.offender.startsWith('src/relay/workspace/') || v.offender.startsWith('src/relay/yc/'),
        );
        expect(hits.map(format).join(''), 'browser entry reached server-side execution').toBe('');
      });

      it('cannot reach a provider connector runtime', () => {
        const hits = violations.filter((v) => v.offender.startsWith('src/relay/connectors/'));
        expect(hits.map(format).join(''), 'browser entry reached a provider connector').toBe('');
      });

      it('cannot reach the deterministic test fixtures', () => {
        // relay-core-boundary.test.ts bans this edge too, but only for the
        // CORE_ROOTS it walks — ui/, mission/, shared/ and the src/relay/*.tsx
        // entries are not in that list. This walk starts at the real browser
        // entry and follows the transitive closure, so it closes the gap for
        // every browser root at once rather than for a hand-listed few.
        const hits = violations.filter((v) => v.offender.startsWith('src/relay/testing/'));
        expect(hits.map(format).join(''), 'browser entry reached the test fixtures').toBe('');
      });

      it('cannot reach the bridge server or repository tooling', () => {
        const hits = violations.filter(
          (v) => v.offender.startsWith('relay-bridge/') || v.offender.startsWith('scripts/'),
        );
        expect(hits.map(format).join(''), 'browser entry reached server/tooling code').toBe('');
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

      it('cannot reach ANY Node built-in, in any spelling', () => {
        const hits = violations.filter((v) => v.why === 'a Node built-in');
        expect(hits.map(format).join('')).toBe('');
      });

      it('contains no dynamic import this guard cannot resolve', () => {
        const hits = violations.filter((v) => v.form === 'dynamic import (interpolated)');
        expect(hits.map(format).join(''), 'an unanalyzable edge is a hole in this guard').toBe('');
      });

      it('has no violation of ANY kind', () => {
        expect(violations.map(format).join('')).toBe('');
      });
    });
  }

  it('the shared seam is itself browser safe', () => {
    const { violations } = walk({ root: ROOT, entry: 'src/relay/shared/index.ts' });
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

  it('no file under src/relay/ui imports a server-only module', () => {
    const offenders: string[] = [];
    const aliases = configuredAliases(ROOT);
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          visit(full);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name)) continue;
        if (/\.test\.[tj]sx?$/.test(name)) continue; // tests run in Node by design
        const src = readFileSync(full, 'utf8');
        for (const { spec } of specifiersOf(src)) {
          const target = resolveSpecifier(ROOT, full, spec, aliases);
          if (target === null) continue;
          const rel = relative(ROOT, target);
          const hit = FORBIDDEN_DIRS.find(
            (d) => rel.startsWith(d.prefix) && !(d.allow ?? []).includes(rel),
          );
          if (hit) offenders.push(`${relative(ROOT, full)} → ${spec} (${hit.why})`);
        }
      }
    };
    visit(join(relayRoot, 'ui'));
    expect(offenders).toEqual([]);
  });

  /**
   * The allowance for two connector modules must never become a laundering
   * channel for the rest of the directory. Purity is re-derived from source,
   * not taken on trust.
   */
  it('the allowlisted connector contracts are genuinely pure', () => {
    for (const contract of PURE_CONNECTOR_CONTRACTS) {
      const full = join(ROOT, contract);
      expect(existsSync(full), `${contract} must exist`).toBe(true);

      // Nothing in their transitive graph may reach a Node built-in or any
      // other forbidden family — including the connector runtimes beside them.
      const { violations } = walk({ root: ROOT, entry: contract });
      expect(violations.map(format).join(''), `${contract} is not browser safe`).toBe('');

      // No runtime escape hatches, whatever the graph says. Each pattern is
      // written against the CODE form rather than the bare word, so prose and
      // simulated data ("node: 'sim-20'") cannot trip it and, more
      // importantly, cannot be used to hide a real one.
      const source = readFileSync(full, 'utf8');
      const smells: Array<[RegExp, string]> = [
        [/['"`]node:[a-z_/]+['"`]/, 'a node: module specifier'],
        [/['"`](child_process|fs|os|path|net|http|https|worker_threads)['"`]/, 'a bare Node built-in specifier'],
        [/\bfetch\s*\(/, 'a fetch call'],
        [/\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/, 'a network client'],
        [/\b(localStorage|sessionStorage|indexedDB)\b/, 'browser storage'],
        [/\bprocess\s*\.\s*(env|argv|cwd|exit)\b/, 'a process reference'],
        [/\beval\s*\(/, 'eval'],
        [/\bnew\s+Function\s*\(/, 'the Function constructor'],
      ];
      for (const [pattern, what] of smells) {
        expect(pattern.test(source), `${contract} contains ${what}`).toBe(false);
      }
    }
  });

  it('no unguarded module alias is configured', () => {
    // The walker follows tsconfig `paths`. Vite aliases are NOT parsed, so if
    // one is ever configured this guard must be taught about it before the
    // alias can route an edge around the walk.
    const vite = readFileSync(join(ROOT, 'vite.config.mts'), 'utf8');
    expect(
      /resolve\s*:\s*\{[^}]*alias/s.test(vite),
      'a Vite alias was configured — teach configuredAliases() about it',
    ).toBe(false);
    // tsconfig paths ARE supported; this records the current state.
    expect(configuredAliases(ROOT)).toEqual([]);
  });
});

/* ============================================= adversarial fixtures */

/**
 * Every recognised graph form, proven against a temporary tree. Each fixture
 * routes a browser entry to a forbidden module by a DIFFERENT mechanism; if
 * the walker stops recognising one, its case fails here rather than silently
 * passing in the real repository.
 */
describe('the guard catches every recognised graph form', () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-browser-boundary-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, content: string) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  };

  // A forbidden module in each family, plus one legitimate browser module.
  write('src/relay/cli/render.ts', "export const render = () => 'cli';\n");
  write('src/relay/persistence/store.ts', "export const store = 'persistence';\n");
  write('src/relay/workspace/command-runner.ts', "export const run = () => 'shell';\n");
  write('src/relay/yc/node-deps.ts', "export const git = () => 'git';\n");
  write('src/relay/connectors/claude-code/live-runner.ts', "export const live = () => 'provider';\n");
  write('src/relay/connectors/ports.ts', 'export type Port = { id: string };\n');
  write('src/relay/testing/factories.ts', 'export const testClock = () => 0;\n');
  write('scripts/relay-repository-boundary.mjs', 'export const scan = () => true;\n');
  write('relay-bridge/server.ts', "export const serve = () => 'server';\n");
  write('src/relay/safe/index.ts', "export const safe = 'ok';\n");
  write('src/relay/safe/deep.mts', "export const deep = 'ok';\n");
  write('src/relay/globbed/one.ts', "export const one = 1;\n");
  write('vite.config.mts', 'export default {};\n');
  write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@relay/*': ['src/relay/*'] } } }));

  const entryFor = (name: string, body: string) => {
    const rel = `src/entries/${name}.tsx`;
    write(rel, body);
    return rel;
  };

  const offendersOf = (entry: string) => walk({ root, entry }).violations.map((v) => v.offender);

  it('a clean entry produces no violation — the fixture harness is not trivially red', () => {
    const entry = entryFor('clean', "import { safe } from '../relay/safe';\nexport const x = safe;\n");
    expect(walk({ root, entry }).violations).toEqual([]);
    expect(walk({ root, entry }).modules.size).toBeGreaterThan(1);
  });

  it('catches a relative static import', () => {
    const entry = entryFor('relative', "import { render } from '../relay/cli/render';\nexport const x = render;\n");
    expect(offendersOf(entry)).toContain('src/relay/cli/render.ts');
  });

  it('catches a root-absolute /src/... import', () => {
    const entry = entryFor('absolute', "import { render } from '/src/relay/cli/render';\nexport const x = render;\n");
    expect(offendersOf(entry)).toContain('src/relay/cli/render.ts');
  });

  it('catches a configured tsconfig path alias', () => {
    const entry = entryFor('alias', "import { store } from '@relay/persistence/store';\nexport const x = store;\n");
    expect(offendersOf(entry)).toContain('src/relay/persistence/store.ts');
  });

  it('catches an export-from declaration', () => {
    const entry = entryFor('exportfrom', "export * from '../relay/workspace/command-runner';\n");
    expect(offendersOf(entry)).toContain('src/relay/workspace/command-runner.ts');
  });

  it('catches a named export-from declaration', () => {
    const entry = entryFor('exportnamed', "export { git } from '../relay/yc/node-deps';\n");
    expect(offendersOf(entry)).toContain('src/relay/yc/node-deps.ts');
  });

  it('catches a side-effect import', () => {
    const entry = entryFor('sideeffect', "import '../relay/cli/render';\nexport const x = 1;\n");
    expect(offendersOf(entry)).toContain('src/relay/cli/render.ts');
  });

  it('catches a type-only import — a type edge is still a layering edge', () => {
    const entry = entryFor('typeonly', "import type { Port } from '../relay/connectors/claude-code/live-runner';\nexport type X = Port;\n");
    expect(offendersOf(entry)).toContain('src/relay/connectors/claude-code/live-runner.ts');
  });

  it('catches a dynamic import with a string literal', () => {
    const entry = entryFor('dynamic', "export const load = () => import('../relay/persistence/store');\n");
    expect(offendersOf(entry)).toContain('src/relay/persistence/store.ts');
  });

  it('catches a dynamic import written as a static template literal', () => {
    const entry = entryFor('template', 'export const load = () => import(`../relay/cli/render`);\n');
    expect(offendersOf(entry)).toContain('src/relay/cli/render.ts');
  });

  it('reports an INTERPOLATED dynamic import instead of ignoring it', () => {
    const entry = entryFor('interpolated', 'export const load = (n: string) => import(`../relay/${n}`);\n');
    const { violations } = walk({ root, entry });
    expect(violations.map((v) => v.form)).toContain('dynamic import (interpolated)');
  });

  it('catches require()', () => {
    const entry = entryFor('require', "export const x = require('../relay/cli/render');\n");
    expect(offendersOf(entry)).toContain('src/relay/cli/render.ts');
  });

  it('catches import.meta.glob', () => {
    write('src/relay/globbed/bad.ts', "export * from '../cli/render';\n");
    const entry = entryFor('glob', "export const mods = import.meta.glob('../relay/globbed/*.ts');\nexport const x = mods;\n");
    const { modules, violations } = walk({ root, entry });
    const seen = [...modules].map((m) => relative(root, m));
    expect(seen, 'the glob must expand to the files it matches').toContain('src/relay/globbed/one.ts');
    expect(violations.map((v) => v.offender)).toContain('src/relay/cli/render.ts');
  });

  it('catches new Worker(new URL(..., import.meta.url))', () => {
    const entry = entryFor(
      'worker',
      "export const w = new Worker(new URL('../relay/workspace/command-runner.ts', import.meta.url));\n",
    );
    expect(offendersOf(entry)).toContain('src/relay/workspace/command-runner.ts');
  });

  it('catches every module extension, including .mjs/.cjs/.mts/.cts', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']) {
      write(`src/relay/cli/ext${ext.replace('.', '-')}${ext}`, 'export const x = 1;\n');
      const entry = entryFor(
        `ext${ext.replace('.', '')}`,
        `import { x } from '../relay/cli/ext${ext.replace('.', '-')}';\nexport const y = x;\n`,
      );
      expect(offendersOf(entry), ext).toContain(`src/relay/cli/ext${ext.replace('.', '-')}${ext}`);
    }
  });

  it('catches a directory index file', () => {
    write('src/relay/cli/barrel/index.ts', "export const barrel = 'cli';\n");
    const entry = entryFor('index', "import { barrel } from '../relay/cli/barrel';\nexport const x = barrel;\n");
    expect(offendersOf(entry)).toContain('src/relay/cli/barrel/index.ts');
  });

  it('catches a TRANSITIVE edge and names the whole chain', () => {
    write('src/relay/safe/hop.ts', "export * from '../persistence/store';\n");
    const entry = entryFor('transitive', "export * from '../relay/safe/hop';\n");
    const { violations } = walk({ root, entry });
    const hit = violations.find((v) => v.offender === 'src/relay/persistence/store.ts');
    expect(hit, 'the transitive edge must be reported').toBeDefined();
    expect(hit!.chain).toEqual([
      'src/entries/transitive.tsx',
      'src/relay/safe/hop.ts',
      'src/relay/persistence/store.ts',
    ]);
  });

  it('catches every Node built-in spelling', () => {
    for (const spec of ['node:fs', 'fs', 'node:child_process', 'child_process', 'node:worker_threads', 'os', 'node:vm', 'inspector']) {
      const entry = entryFor(
        `builtin-${spec.replace(/[:/]/g, '-')}`,
        `import * as m from '${spec}';\nexport const x = m;\n`,
      );
      expect(offendersOf(entry), spec).toContain(spec);
    }
  });

  it('catches the bridge server and repository tooling', () => {
    const bridge = entryFor('bridge', "export * from '../../relay-bridge/server';\n");
    expect(offendersOf(bridge)).toContain('relay-bridge/server.ts');
    const tooling = entryFor('tooling', "export * from '../../scripts/relay-repository-boundary.mjs';\n");
    expect(offendersOf(tooling)).toContain('scripts/relay-repository-boundary.mjs');
  });

  it('catches the deterministic test fixtures', () => {
    const entry = entryFor('fixtures', "import { testClock } from '../relay/testing/factories';\nexport const x = testClock;\n");
    expect(offendersOf(entry)).toContain('src/relay/testing/factories.ts');
  });

  it('does NOT forbid a genuinely pure connector contract', () => {
    const entry = entryFor('purecontract', "import type { Port } from '../relay/connectors/ports';\nexport type X = Port;\n");
    const { violations } = walk({
      root,
      entry,
      forbidden: FORBIDDEN_DIRS.map((d) =>
        d.prefix === 'src/relay/connectors/' ? { ...d, allow: ['src/relay/connectors/ports.ts'] } : d,
      ),
    });
    expect(violations).toEqual([]);
  });

  it('an npm package specifier is not treated as a boundary hit', () => {
    const entry = entryFor('npm', "import { useState } from 'react';\nexport const x = useState;\n");
    expect(walk({ root, entry }).violations).toEqual([]);
  });
});
