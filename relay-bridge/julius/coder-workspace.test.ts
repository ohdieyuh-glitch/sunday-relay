import { describe, expect, it } from 'vitest';

import {
  juliusAttemptCloseCommand,
  juliusAttemptStartCommand,
  parseJuliusAttemptClose,
  parseJuliusAttemptStart,
} from './coder-workspace';

/**
 * THE TWO COMMANDS THAT MAKE AN ATTEMPT'S WORK IDENTIFIABLE, and what they print.
 *
 * They run in the independent executor's sandbox, so what matters here is that
 * they take a snapshot WITHOUT touching the real index or the staging state a
 * coder or a reviewer would see, that only a tree id ever reaches a command
 * string, and that their output is read back exactly.
 */

const TREE = (seed: string): string => seed.repeat(40).slice(0, 40);
const BASE = TREE('b');
const START = TREE('5');
const END = TREE('e');
const NUL = String.fromCharCode(0);
const SECTION = `${NUL}JULIUS-SECTION-9f2a${NUL}`;
const z = (...fields: readonly string[]): string => fields.map((field) => `${field}${NUL}`).join('');

describe('the snapshot never disturbs the workspace it measures', () => {
  it('writes into a temporary index, and removes it again', () => {
    const start = juliusAttemptStartCommand(null);
    expect(start).toContain('GIT_INDEX_FILE=/tmp/julius-attempt-index');
    expect(start).toContain('git add -A -- .');
    expect(start).toContain('git write-tree');
    expect(start).toContain('rm -f "$GIT_INDEX_FILE"');
    // NOTHING that writes the real index, the staging state, or the working tree.
    for (const forbidden of ['git reset', 'git stash', 'git commit', 'git clean']) {
      expect(start, forbidden).not.toContain(forbidden);
    }
  });

  it('runs the change set with the temporary index unset, or git would compare against the snapshot', () => {
    const close = juliusAttemptCloseCommand({ baseTree: BASE, startTree: START });
    const unset = close.indexOf('unset GIT_INDEX_FILE');
    const status = close.indexOf('git status --porcelain=v1 --untracked-files=all -z');
    expect(unset).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(unset);
  });

  it('asks for the three tree diffs that attribute the attempt', () => {
    const close = juliusAttemptCloseCommand({ baseTree: BASE, startTree: START });
    expect(close).toContain(`git diff --name-status -z ${START} "$END"`);
    expect(close).toContain(`git diff --name-status -z ${BASE} ${START}`);
    expect(close).toContain(`git diff --name-status -z ${BASE} "$END"`);
  });

  it('with no start snapshot it is the plain change set, and claims no attribution', () => {
    expect(juliusAttemptCloseCommand(null)).toBe('git status --porcelain=v1 --untracked-files=all -z');
    expect(juliusAttemptCloseCommand({ baseTree: 'HEAD', startTree: START })).toBe('git status --porcelain=v1 --untracked-files=all -z');
  });
});

describe('the undo, when Julius asks for one', () => {
  it('guards on the tree the refused attempt left, and puts back only what it changed', () => {
    const start = juliusAttemptStartCommand({ toTree: START, expectedTree: END });
    expect(start).toContain(`if [ "$CUR" = "${END}" ]; then`);
    expect(start).toContain(`git read-tree ${START}`);
    expect(start).toContain(`git diff --name-only --diff-filter=A -z ${START} "$CUR" | xargs -0 -r rm -f --`);
    expect(start).toContain('git checkout-index -f -u --');
    expect(start).toContain('RESTORE REFUSED_TREE_MOVED');
    expect(start).not.toContain('git reset --hard');
  });

  it('never interpolates anything that is not a tree id', () => {
    const hostile = juliusAttemptStartCommand({ toTree: `${START.slice(1)}; rm -rf /`, expectedTree: END });
    expect(hostile).toContain('RESTORE NONE');
    expect(hostile).not.toContain('rm -rf /');
    expect(hostile).not.toContain('git read-tree');
  });
});

describe('what the start of an attempt printed', () => {
  const output = (...lines: readonly string[]): string => `${lines.join(String.fromCharCode(10))}${String.fromCharCode(10)}`;

  it('reads the commit and the two trees', () => {
    const start = parseJuliusAttemptStart(output('RESTORE NONE', `HEAD ${TREE('a')}`, `BASE ${BASE}`, `START ${START}`), null);
    expect(start).toEqual({ headRevision: TREE('a'), baseTree: BASE, startTree: START, restore: null });
  });

  it('reports a restore that ran, with what it removed and put back', () => {
    const start = parseJuliusAttemptStart(
      output('RESTORE RESTORED 2 3', `HEAD ${TREE('a')}`, `BASE ${BASE}`, `START ${START}`),
      { toTree: START, expectedTree: END },
    );
    expect(start.restore).toEqual({ outcome: 'RESTORED', toTree: START, expectedTree: END, observedTree: START, removed: 2, restored: 3 });
  });

  it('reports a refusal, and a request whose output says nothing is refused too — never assumed done', () => {
    const moved = parseJuliusAttemptStart(output('RESTORE REFUSED_TREE_MOVED', `BASE ${BASE}`, `START ${TREE('9')}`), { toTree: START, expectedTree: END });
    expect(moved.restore).toMatchObject({ outcome: 'REFUSED_TREE_MOVED', observedTree: TREE('9') });
    const silent = parseJuliusAttemptStart('', { toTree: START, expectedTree: END });
    expect(silent.restore).toMatchObject({ outcome: 'REFUSED_EXECUTOR', observedTree: null });
    expect(silent).toMatchObject({ headRevision: null, baseTree: null, startTree: null });
  });
});

describe('what the end of an attempt printed', () => {
  const close = (...sections: readonly string[]): string => sections.join(SECTION);

  it('reads the tree it left, the change set, and the three attributions', () => {
    const parsed = parseJuliusAttemptClose(close(
      `END ${END}${String.fromCharCode(10)}`,
      `${z(' M src/b.ts')}${z('?? src/c.ts')}`,
      z('M', 'src/b.ts', 'A', 'src/c.ts'),
      z('M', 'src/a.ts'),
      z('M', 'src/a.ts', 'M', 'src/b.ts', 'A', 'src/c.ts'),
    ), true);
    expect(parsed.endTree).toBe(END);
    expect(parsed.status).toEqual({
      captured: true, truncated: false,
      changes: [{ path: 'src/b.ts', change: 'MODIFIED' }, { path: 'src/c.ts', change: 'UNTRACKED' }],
    });
    expect(parsed.own!.map((change) => change.path)).toEqual(['src/b.ts', 'src/c.ts']);
    expect(parsed.inherited!.map((change) => change.path)).toEqual(['src/a.ts']);
    expect(parsed.cumulative!.map((change) => change.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('a failed capture is uncaptured with no sets at all — not an empty workspace', () => {
    const parsed = parseJuliusAttemptClose('anything', false);
    expect(parsed.status).toEqual({ captured: false, changes: [], truncated: false });
    expect(parsed.endTree).toBeNull();
    expect(parsed.own).toBeNull();
    expect(parsed.inherited).toBeNull();
    expect(parsed.cumulative).toBeNull();
  });

  it('the plain change set is read as before, and attributes nothing', () => {
    const parsed = parseJuliusAttemptClose(z(' M src/b.ts'), true);
    expect(parsed.status.changes).toEqual([{ path: 'src/b.ts', change: 'MODIFIED' }]);
    expect(parsed.own).toBeNull();
    expect(parsed.endTree).toBeNull();
  });

  it('carries truncation from whichever set hit the bound', () => {
    const many = Array.from({ length: 460 }, (_value, index) => ['M', `src/f${String(index)}.ts`]).flat();
    const parsed = parseJuliusAttemptClose(close(`END ${END}${String.fromCharCode(10)}`, '', z(...many), '', ''), true);
    expect(parsed.truncated).toBe(true);
  });
});
