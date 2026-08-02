import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * RELAY UI BOUNDARY — the dependency direction between the website tree and
 * everything else.
 *
 * `src/relay/shared/browser-boundary.test.ts` walks OUTWARD: it proves the
 * browser never reaches the CLI, the Node persistence layer, the workspace or
 * a provider runtime. Nothing walked INWARD, so the opposite mistake was
 * invisible: the Relay bridge and the mission layer could not describe a
 * mission without importing `src/relay/ui/app/contracts.ts`, because the
 * mission wire contracts were filed under the website.
 *
 * The rule here is the missing half. `ui/` is a CONSUMER of the domain, never
 * a supplier to it: a module outside `src/relay/ui` may not import one inside
 * it. Domain contracts live on the domain side of that line
 * (`src/relay/mission/wire-contracts.ts`), and the UI imports them.
 *
 * Two properties make the rule hard to dodge:
 *   - it is CONTAINMENT-based, not substring-based. An import is a violation
 *     when it RESOLVES to a file inside `src/relay/ui`, so renaming a
 *     directory, adding a deeper nesting level, or spelling the specifier
 *     with extra `../` hops changes nothing.
 *   - the non-UI roots are READ FROM DISK, never hand-listed, so a module root
 *     added tomorrow is covered the day it appears rather than the day someone
 *     remembers to extend an array.
 *
 * *.test.ts files are INCLUDED. Excluding them would have permanently licensed
 * the violation this rule was written for (a mission test importing the UI
 * contracts barrel), and a test that reaches across the boundary is how the
 * dependency creeps back into production code.
 */

const root = process.cwd();
const RELAY_DIR = join(root, 'src', 'relay');
const UI_DIR = join(RELAY_DIR, 'ui');

/** Relative, POSIX-style — the form the allowlists below are written in. */
const rel = (file: string): string => relative(root, file).split(sep).join('/');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/**
 * Every root that is NOT the UI. Read from disk: every directory under
 * `src/relay` except `ui`, plus the Node bridge package. Files sitting
 * directly at the `src/relay` root (main.tsx, RelayApp.tsx …) are browser
 * entry points and legitimately mount the UI, so they are not roots here.
 */
const NON_UI_ROOTS: string[] = [
  ...readdirSync(RELAY_DIR)
    .filter((name) => name !== 'ui' && statSync(join(RELAY_DIR, name)).isDirectory())
    .map((name) => join(RELAY_DIR, name)),
  join(root, 'relay-bridge'),
];

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx'];

/** Resolve a relative specifier to a real file; null for bare specifiers
 * (npm packages, `node:` builtins) and anything that does not resolve. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every relative import of a file, resolved to an absolute path — including
 * INLINE `import('…')` type references. The inline form carries no `from`
 * clause, so a rule that only matched `from '…'` would miss it, and the
 * bridge used exactly that form to reach the UI contracts.
 */
const IMPORT_SPECIFIER = /from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolvedImportsOf(file: string): Array<{ spec: string; target: string }> {
  const out: Array<{ spec: string; target: string }> = [];
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
    const spec = m[1] ?? m[2];
    const target = spec ? resolveImport(file, spec) : null;
    if (target) out.push({ spec, target });
  }
  return out;
}

/** Real containment, not a name match. */
const isInside = (target: string, dir: string): boolean =>
  target === dir || target.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/**
 * THE ONE ALLOWED UI MODULE.
 *
 * `terminal-sanitize.ts` is a pure string sanitizer — it redacts external ids
 * and bounds terminal output. The bridge (`relay-bridge/coding-terminal.ts`)
 * runs it on captured provider output BEFORE that output is ever persisted or
 * sent, so the sanitizer must be the same code the browser trusts; a second
 * copy on the Node side is precisely how a redaction rule drifts and a secret
 * escapes. It is a runtime utility, not a contract, so it is not part of the
 * wire-contracts move.
 *
 * It is allowlisted rather than assumed: `the allowlisted UI module is
 * genuinely pure` below re-derives that from source, so the exception cannot
 * rot into a channel for importing real UI. It is one line, and deleting it is
 * all that is needed to close the exception once the sanitizer moves.
 */
const ALLOWED_UI_MODULES = ['src/relay/ui/app/terminal-sanitize.ts'] as const;

/**
 * QUARANTINE — pre-existing violations this rule does not yet fix.
 *
 * Each is a TEST file living under a non-UI root that imports a UI COMPONENT
 * in order to render it. They are misfiled tests, not production dependencies:
 * no shipping module reaches the UI through them. Moving them is a separate
 * change in files that belong to other work packages, so they are parked here
 * — visibly, with a reason — rather than being silently excluded by dropping
 * *.test.ts from the walk, which would have licensed every future test
 * violation as well.
 *
 * The list is SELF-CLEANING: `the quarantine is exact` below fails if an entry
 * stops violating, forcing its deletion instead of letting a stale exception
 * accumulate. It also fails if a non-test file is ever added, so production
 * code can never be parked here.
 */
const QUARANTINED_TEST_VIOLATIONS = [
  'src/relay/cli/simulated-data-disclosure.test.ts',
  'src/relay/mission/economics/unknown-cost.test.ts',
  'relay-bridge/orchestrator.test.ts',
] as const;

const isAllowedTarget = (target: string): boolean =>
  (ALLOWED_UI_MODULES as readonly string[]).includes(rel(target));

const isQuarantined = (file: string): boolean =>
  (QUARANTINED_TEST_VIOLATIONS as readonly string[]).includes(rel(file));

/** Every non-UI source file, in a stable order. */
const nonUiFiles: string[] = NON_UI_ROOTS.filter((dir) => existsSync(dir)).flatMap(walk);

/** `<file> → <specifier>` for every import that lands inside `src/relay/ui`. */
function uiImportsOf(file: string): string[] {
  return resolvedImportsOf(file)
    .filter(({ target }) => isInside(target, UI_DIR))
    .map(({ spec }) => `${rel(file)} → ${spec}`);
}

describe('Relay UI boundary — the UI is a consumer of the domain, never a supplier', () => {
  it('finds the non-UI roots and their sources', () => {
    expect(NON_UI_ROOTS.length).toBeGreaterThan(10);
    expect(nonUiFiles.length).toBeGreaterThan(100);
    // The roots come from disk, so the two that motivated the rule must be
    // present without being named in the walk itself.
    expect(NON_UI_ROOTS).toContain(join(RELAY_DIR, 'mission'));
    expect(NON_UI_ROOTS).toContain(join(root, 'relay-bridge'));
    expect(NON_UI_ROOTS).not.toContain(UI_DIR);
  });

  it('no non-UI module imports a UI module', () => {
    const offenders: string[] = [];
    for (const file of nonUiFiles) {
      if (isQuarantined(file)) continue;
      for (const { spec, target } of resolvedImportsOf(file)) {
        if (!isInside(target, UI_DIR)) continue;
        if (isAllowedTarget(target)) continue;
        offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(offenders, 'these modules must not depend inward on the website tree').toEqual([]);
    // A GENEROUS, EXPLICIT TIME BUDGET — not a weakened assertion.
    //
    // This walk resolves every relative import of every non-UI module, and its
    // cost grows with the tree. Adding `src/relay/mcp` pushed it past vitest's
    // 5s default on a 2-core host, which failed the test for taking too long
    // rather than for finding anything. The assertion above is unchanged and
    // still fails on the FIRST inward import; only the clock is different.
  }, 60_000);

  it('the mission wire contracts are on the domain side and import nothing', () => {
    // The fix is only real while the contracts stay importable without pulling
    // anything else in — that is what lets the bridge, the mission layer and
    // the browser all read the same declaration.
    const wire = join(RELAY_DIR, 'mission', 'wire-contracts.ts');
    expect(existsSync(wire), 'mission/wire-contracts.ts must exist').toBe(true);
    expect(resolvedImportsOf(wire)).toEqual([]);
    const src = readFileSync(wire, 'utf8');
    expect(/from\s*['"]/.test(src), 'wire-contracts.ts must import nothing at all').toBe(false);
    expect(/from\s+['"]react|from\s+['"]node:/.test(src)).toBe(false);
    // And the browser barrel still serves them, so UI import sites are unchanged.
    const barrel = join(UI_DIR, 'app', 'contracts.ts');
    expect(readFileSync(barrel, 'utf8')).toContain("from '../../mission/wire-contracts'");
  });

  it('the allowlisted UI module is genuinely pure (the exception cannot launder real UI)', () => {
    for (const name of ALLOWED_UI_MODULES) {
      const file = join(root, name);
      expect(existsSync(file), `${name} must exist`).toBe(true);
      const src = readFileSync(file, 'utf8');
      expect(/from\s+['"]react|from\s+['"]node:/.test(src), `${name} must be framework-free`).toBe(false);
      expect(/\b(document|window|localStorage|navigator)\./.test(src), `${name} must touch no browser API`).toBe(false);
      // It pulls in nothing, so allowing it widens the boundary by zero modules.
      expect(resolvedImportsOf(file), `${name} must import nothing`).toEqual([]);
    }
  });

  it('the quarantine is exact: every entry is a test file that still violates', () => {
    for (const name of QUARANTINED_TEST_VIOLATIONS) {
      const file = join(root, name);
      expect(existsSync(file), `${name} is quarantined but does not exist — delete the entry`).toBe(true);
      expect(/\.test\.tsx?$/.test(name), `${name} is not a test file — production code may never be quarantined`).toBe(true);
      expect(
        uiImportsOf(file).length,
        `${name} no longer imports the UI — delete its quarantine entry`,
      ).toBeGreaterThan(0);
    }
  });
});
