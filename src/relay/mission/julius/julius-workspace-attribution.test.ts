import { describe, expect, it } from 'vitest';

import {
  JULIUS_ATTEMPT_WORKSPACE_VERSION,
  JULIUS_WORKSPACE_RESTORE_OUTCOMES,
  isJuliusTreeId,
  juliusRestoreRequestFor,
  juliusWorkspaceCleanliness,
  parseJuliusTreeDiff,
  readJuliusAttemptWorkspace,
} from './julius-workspace-attribution';
import { JULIUS_WORKSPACE_LIMITS } from './julius-coding-agent';

/**
 * WHICH ATTEMPT CHANGED WHAT — the rules, without a workspace.
 *
 * Three trees decide it: what HEAD held, what the attempt found, what it left.
 * Everything here is about refusing to guess when one of them is missing.
 */

const TREE = (seed: string): string => seed.repeat(40).slice(0, 40);
const BASE = TREE('b');
const START = TREE('5');
const END = TREE('e');
const NUL = String.fromCharCode(0);
const z = (...fields: readonly string[]): string => fields.map((field) => `${field}${NUL}`).join('');

const captured = (over: Record<string, unknown> = {}) => ({
  baseTree: BASE, startTree: START, endTree: END,
  own: [{ path: 'src/b.ts', change: 'MODIFIED' }],
  inherited: [{ path: 'src/a.ts', change: 'MODIFIED' }],
  cumulative: [{ path: 'src/a.ts', change: 'MODIFIED' }, { path: 'src/b.ts', change: 'MODIFIED' }],
  ...over,
});

describe('a tree id is forty hex characters, and nothing else reaches a command', () => {
  it('accepts what git prints and refuses everything else', () => {
    expect(isJuliusTreeId(BASE)).toBe(true);
    for (const value of [null, undefined, 42, `${BASE}x`, BASE.slice(1), BASE.toUpperCase(), `${BASE.slice(1)}; rm -rf /`, 'HEAD', '']) {
      expect(isJuliusTreeId(value), String(value)).toBe(false);
    }
  });
});

describe('the change set between two trees', () => {
  it('reads statuses, paths and the two-path forms', () => {
    const diff = parseJuliusTreeDiff(z('M', 'src/a.ts', 'A', 'src/new.ts', 'D', 'src/gone.ts', 'T', 'src/link.ts'));
    expect(diff.changes).toEqual([
      { path: 'src/a.ts', change: 'MODIFIED' },
      { path: 'src/new.ts', change: 'ADDED' },
      { path: 'src/gone.ts', change: 'DELETED' },
      { path: 'src/link.ts', change: 'MODIFIED' },
    ]);
    expect(diff.truncated).toBe(false);
  });

  it('a rename is the new path, and the old one is gone', () => {
    expect(parseJuliusTreeDiff(z('R100', 'src/old.ts', 'src/new.ts')).changes).toEqual([
      { path: 'src/old.ts', change: 'DELETED' },
      { path: 'src/new.ts', change: 'RENAMED' },
    ]);
    // A copy leaves the source where it was.
    expect(parseJuliusTreeDiff(z('C75', 'src/from.ts', 'src/to.ts')).changes).toEqual([{ path: 'src/to.ts', change: 'ADDED' }]);
  });

  it('empty output is an empty set, and a path it cannot read is dropped rather than guessed', () => {
    expect(parseJuliusTreeDiff('').changes).toEqual([]);
    expect(parseJuliusTreeDiff(z('M', `src/${String.fromCharCode(7)}bell.ts`)).changes).toEqual([]);
    expect(parseJuliusTreeDiff(z('M', `src/${'x'.repeat(JULIUS_WORKSPACE_LIMITS.pathChars)}.ts`)).changes).toEqual([]);
  });

  it('says when it stopped counting instead of silently cutting the set', () => {
    const many = Array.from({ length: JULIUS_WORKSPACE_LIMITS.paths + 40 }, (_value, index) => ['M', `src/f${String(index)}.ts`]).flat();
    const diff = parseJuliusTreeDiff(z(...many));
    expect(diff.changes).toHaveLength(JULIUS_WORKSPACE_LIMITS.paths);
    expect(diff.truncated).toBe(true);
  });
});

describe('an attempt record is captured only when all three trees are', () => {
  it('reads a complete record and keeps the three sets apart', () => {
    const attempt = readJuliusAttemptWorkspace(captured());
    expect(attempt.version).toBe(JULIUS_ATTEMPT_WORKSPACE_VERSION);
    expect(attempt.captured).toBe(true);
    expect(attempt.own.map((change) => change.path)).toEqual(['src/b.ts']);
    expect(attempt.inherited.map((change) => change.path)).toEqual(['src/a.ts']);
    expect(attempt.cumulative.map((change) => change.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('a missing tree or an unreadable set makes the WHOLE record uncaptured, with empty sets', () => {
    for (const over of [
      { baseTree: null }, { startTree: null }, { endTree: null },
      { baseTree: 'HEAD' }, { endTree: `${END}x` },
      { own: null }, { inherited: 'some' }, { cumulative: [{ path: 'a', change: 'TELEPORTED' }] },
      { own: [{ path: 'a' }] },
    ]) {
      const attempt = readJuliusAttemptWorkspace(captured(over));
      expect(attempt.captured, JSON.stringify(over)).toBe(false);
      expect(attempt.own).toEqual([]);
      expect(attempt.inherited).toEqual([]);
      expect(attempt.cumulative).toEqual([]);
      expect(attempt.baseTree).toBeNull();
      expect(attempt.startTree).toBeNull();
      expect(attempt.endTree).toBeNull();
    }
    for (const value of [null, undefined, 'a record', 42, []]) {
      expect(readJuliusAttemptWorkspace(value).captured, String(value)).toBe(false);
    }
  });

  it('an uncaptured record still says what happened to a restore, because that is the part that acted', () => {
    const attempt = readJuliusAttemptWorkspace({
      startTree: null,
      restore: { outcome: 'REFUSED_TREE_MOVED', toTree: START, expectedTree: END, observedTree: null, removed: 0, restored: 0 },
    });
    expect(attempt.captured).toBe(false);
    expect(attempt.restore).toMatchObject({ outcome: 'REFUSED_TREE_MOVED', toTree: START, expectedTree: END });
  });

  it('a restore record is read from an allowlist: an outcome it does not know is no record at all', () => {
    expect(readJuliusAttemptWorkspace(captured({ restore: { outcome: 'WIPED_EVERYTHING', toTree: START } })).restore).toBeNull();
    expect(readJuliusAttemptWorkspace(captured({ restore: { outcome: 'RESTORED', toTree: 'HEAD~1', expectedTree: END, removed: -3, restored: 1.5 } })).restore)
      .toEqual({ outcome: 'RESTORED', toTree: null, expectedTree: END, observedTree: null, removed: 0, restored: 0 });
    expect(JULIUS_WORKSPACE_RESTORE_OUTCOMES).toEqual(['RESTORED', 'REFUSED_TREE_MOVED', 'REFUSED_UNKNOWN_SNAPSHOT', 'REFUSED_EXECUTOR']);
  });
});

describe('unknown is never clean', () => {
  it('an unread workspace is UNKNOWN, a read one says what it found', () => {
    expect(juliusWorkspaceCleanliness({ captured: false, changes: [] })).toBe('UNKNOWN');
    // The set is empty because nothing is known, which is exactly the case that used to read as clean.
    expect(juliusWorkspaceCleanliness({ captured: false, changes: [{ path: 'a', change: 'MODIFIED' }] })).toBe('UNKNOWN');
    expect(juliusWorkspaceCleanliness({ captured: true, changes: [] })).toBe('OBSERVED_CLEAN');
    expect(juliusWorkspaceCleanliness({ captured: true, changes: [{ path: 'a', change: 'MODIFIED' }] })).toBe('OBSERVED_CHANGED');
  });
});

describe('the one undo Julius authorises', () => {
  const failedOutOfScope = { outcome: 'FAILED' as const, scopeViolations: 2, startTree: START, endTree: END };

  it('is asked for only when a failed attempt left changes its own contract refused', () => {
    expect(juliusRestoreRequestFor({ lastAttempt: failedOutOfScope })).toEqual({ startTree: START, endTree: END });
  });

  it('is never asked for anything else', () => {
    for (const lastAttempt of [
      null,
      { ...failedOutOfScope, outcome: 'SUCCEEDED' as const },
      { ...failedOutOfScope, scopeViolations: 0 },
      { ...failedOutOfScope, startTree: null },
      { ...failedOutOfScope, endTree: null },
      { ...failedOutOfScope, startTree: 'HEAD' },
      // An attempt that left the workspace exactly as it found it has nothing to undo.
      { ...failedOutOfScope, endTree: START },
    ]) {
      expect(juliusRestoreRequestFor({ lastAttempt }), JSON.stringify(lastAttempt)).toBeNull();
    }
  });
});
