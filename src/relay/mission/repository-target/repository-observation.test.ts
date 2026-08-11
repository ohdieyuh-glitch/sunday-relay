import { describe, expect, it } from 'vitest';

import {
  baseMovedUnderMission,
  createRepositoryRegistration,
  enforceChangeCeilings,
  judgeObservedDiff,
  resolveRepositoryTarget,
} from './index';
import type {
  ChangeCeilings,
  MissionRepositoryTarget,
  ObservedDiff,
  ObservedFileChange,
  RepositoryRegistrationDraft,
} from './index';

/**
 * WHAT RELAY OBSERVED, AND WHAT IT MEANS.
 *
 * `ChangeCeilings` and `allowDeletions` sat in the contracts, fully documented,
 * with nothing reading them. This file is the enforcement, and the two most
 * important cases in it are the ones that look like edge cases and are not:
 *
 *   - A change whose removed-line count is UNKNOWN. Every real repository has
 *     binary files, and a null count summed as zero is a ceiling that watched a
 *     repository be deleted and reported nothing.
 *   - A diff that breaks one rule and satisfies another. A partial accept would
 *     commit the allowed half of a diff whose other half touched protected
 *     paths, leaving the repository in a state no Reviewer ever read.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const draft = (overrides: Partial<RepositoryRegistrationDraft> = {}): RepositoryRegistrationDraft => ({
  identity: { provider: 'local', host: null, owner: null, name: 'demo', defaultBranch: 'main' },
  location: { kind: 'local_path', path: '/tmp/demo' },
  scope: { read: ['**'], write: ['src/**'] },
  grants: [
    { permission: 'read', authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null },
    { permission: 'write_worktree', authorizedBy: 'founder', authorizedAt: NOW, expiresAt: null, note: null },
  ],
  ceilings: { maxFilesChanged: 3, maxLinesRemoved: 50, allowDeletions: false },
  registeredBy: 'founder',
  ...overrides,
});

const target = (overrides: Partial<RepositoryRegistrationDraft> = {}): MissionRepositoryTarget => {
  const registration = createRepositoryRegistration({ draft: draft(overrides), now: NOW });
  if (!registration.ok) throw new Error(`fixture refused: ${registration.error.message}`);
  const resolution = resolveRepositoryTarget({
    registration: registration.value,
    request: {
      repositoryKey: 'local:demo',
      selectedBy: 'founder',
      selectedAt: NOW,
      workingBranch: 'relay/mission-1',
      permissions: ['read', 'write_worktree'],
    },
    now: NOW,
  });
  if (!resolution.ok) throw new Error(`fixture resolution refused: ${resolution.error.message}`);
  return resolution.target;
};

const change = (path: string, overrides: Partial<ObservedFileChange> = {}): ObservedFileChange => ({
  path,
  kind: 'modified',
  linesAdded: 4,
  linesRemoved: 2,
  ...overrides,
});

const diff = (changes: readonly ObservedFileChange[], overrides: Partial<ObservedDiff> = {}): ObservedDiff => ({
  observedBy: 'relay_git_inspection',
  observedAt: NOW,
  changes,
  conflicted: false,
  baselineSha: SHA,
  ...overrides,
});

const CEILINGS: ChangeCeilings = { maxFilesChanged: 3, maxLinesRemoved: 50, allowDeletions: false };

/* ============================================================= ceilings */

describe('change ceilings are enforced, not merely documented', () => {
  it('accepts a diff inside every ceiling', () => {
    const verdict = enforceChangeCeilings({
      diff: diff([change('src/a.ts'), change('src/b.ts')]),
      ceilings: CEILINGS,
    });
    expect(verdict.within).toBe(true);
    expect(verdict.filesChanged).toBe(2);
    expect(verdict.linesRemoved).toBe(4);
  });

  it('refuses too many files rather than truncating the diff', () => {
    const verdict = enforceChangeCeilings({
      diff: diff([change('src/a.ts'), change('src/b.ts'), change('src/c.ts'), change('src/d.ts')]),
      ceilings: CEILINGS,
    });
    // A truncated diff is a Reviewer reading a fragment and answering as though
    // it read the whole thing.
    expect(verdict.within).toBe(false);
    expect(verdict.problems[0]?.refusal).toBe('ceiling_exceeded');
    expect(verdict.problems[0]?.message).toContain('4 files changed');
  });

  it('refuses too many removed lines', () => {
    const verdict = enforceChangeCeilings({
      diff: diff([change('src/a.ts', { linesRemoved: 40 }), change('src/b.ts', { linesRemoved: 40 })]),
      ceilings: CEILINGS,
    });
    expect(verdict.within).toBe(false);
    expect(verdict.linesRemoved).toBe(80);
    expect(verdict.problems.some((p) => p.message.includes('80 lines removed'))).toBe(true);
  });

  it('refuses an UNKNOWN removed-line count instead of summing it as zero', () => {
    const verdict = enforceChangeCeilings({
      // A binary file has no line count. Summed as zero, this diff would pass a
      // removal ceiling while deleting the contents of a file.
      diff: diff([change('src/logo.png', { linesAdded: null, linesRemoved: null })]),
      ceilings: CEILINGS,
    });
    expect(verdict.within).toBe(false);
    expect(verdict.linesRemoved).toBeNull();
    expect(verdict.problems.some((p) => p.message.includes('Unknown is not zero'))).toBe(true);
  });

  it('refuses a deletion when deletions are off, whatever the counts say', () => {
    const verdict = enforceChangeCeilings({
      // Well inside both numeric ceilings.
      diff: diff([change('src/old.ts', { kind: 'deleted', linesAdded: 0, linesRemoved: 1 })]),
      ceilings: CEILINGS,
    });
    expect(verdict.within).toBe(false);
    expect(verdict.problems.some((p) => p.refusal === 'deletion_not_permitted')).toBe(true);
    expect(verdict.deletedPaths).toEqual(['src/old.ts']);
  });

  it('permits a deletion when the founder said deletions are allowed', () => {
    const verdict = enforceChangeCeilings({
      diff: diff([change('src/old.ts', { kind: 'deleted', linesAdded: 0, linesRemoved: 1 })]),
      ceilings: { ...CEILINGS, allowDeletions: true },
    });
    expect(verdict.within).toBe(true);
  });

  it('reports every breached ceiling at once', () => {
    const verdict = enforceChangeCeilings({
      diff: diff([
        change('src/a.ts', { linesRemoved: 60 }),
        change('src/b.ts'), change('src/c.ts'),
        change('src/d.ts', { kind: 'deleted' }),
      ]),
      ceilings: CEILINGS,
    });
    expect(verdict.within).toBe(false);
    // Files, lines and deletions — three separate facts, three refusals.
    expect(verdict.problems.length).toBe(3);
  });
});

/* ============================================================= judgement */

describe('judging an observed diff', () => {
  it('accepts a clean in-scope diff and names what it will commit', () => {
    const judgement = judgeObservedDiff({
      diff: diff([change('src/a.ts'), change('src/b.ts')]),
      target: target(),
    });
    expect(judgement.accepted).toBe(true);
    expect(judgement.committablePaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('refuses a conflicted worktree first and alone', () => {
    const judgement = judgeObservedDiff({
      // Also out of scope and over the file ceiling. Only the conflict is
      // reported: classifying an unfinished merge would report scope violations
      // for conflict markers instead of the one fact that matters.
      diff: diff(
        [change('infra/a.tf'), change('infra/b.tf'), change('infra/c.tf'), change('infra/d.tf')],
        { conflicted: true },
      ),
      target: target(),
    });
    expect(judgement.accepted).toBe(false);
    expect(judgement.problems).toHaveLength(1);
    expect(judgement.problems[0]?.message).toContain('conflicted');
  });

  it('refuses an observation with no baseline revision', () => {
    for (const baselineSha of [null, '   ']) {
      const judgement = judgeObservedDiff({
        diff: diff([change('src/a.ts')], { baselineSha }),
        target: target(),
      });
      // Without it the artifact digest the Reviewer bound its verdict to
      // describes a diff against nothing.
      expect(judgement.accepted, JSON.stringify(baselineSha)).toBe(false);
      expect(judgement.problems[0]?.message).toContain('no baseline revision');
    }
  });

  it('never partially accepts: a protected hit forfeits the allowed paths too', () => {
    const judgement = judgeObservedDiff({
      diff: diff([change('src/a.ts'), change('.github/workflows/ci.yml')]),
      target: target(),
    });
    expect(judgement.accepted).toBe(false);
    // `src/a.ts` is perfectly legal and is still not committed — otherwise the
    // repository ends in a state no Reviewer ever read.
    expect(judgement.scope.allowed).toEqual(['src/a.ts']);
    expect(judgement.committablePaths).toEqual([]);
  });

  it('reports scope, protection and ceilings together', () => {
    const judgement = judgeObservedDiff({
      diff: diff([
        change('.github/workflows/ci.yml'),
        change('infra/main.tf'),
        change('src/a.ts', { kind: 'deleted' }),
        change('src/b.ts'), change('src/c.ts'),
      ]),
      target: target(),
    });
    expect(judgement.accepted).toBe(false);
    const messages = judgement.problems.map((p) => p.message).join(' | ');
    // An agent whose diff breaks four rules should be told four things.
    expect(messages).toContain('Protected paths were changed');
    expect(messages).toContain('outside the write scope');
    expect(messages).toContain('files changed exceeds');
    expect(messages).toContain('may not delete files');
  });

  it('treats an unnormalizable path as a refusal, not as an allowed path', () => {
    const judgement = judgeObservedDiff({
      diff: diff([change('../escape.ts')]),
      target: target(),
    });
    expect(judgement.accepted).toBe(false);
    expect(judgement.scope.invalid).toEqual(['../escape.ts']);
  });

  it('accepts an untracked new file inside the write scope', () => {
    // A new file is the normal output of "add this feature", and `git status`
    // reports it as untracked rather than modified.
    const judgement = judgeObservedDiff({
      diff: diff([change('src/new-thing.ts', { kind: 'untracked', linesRemoved: 0 })]),
      target: target(),
    });
    expect(judgement.accepted).toBe(true);
    expect(judgement.committablePaths).toEqual(['src/new-thing.ts']);
  });
});

/* ========================================================= base moved */

describe('the base is verified unchanged, and absence is never agreement', () => {
  it('reports an unchanged base', () => {
    const result = baseMovedUnderMission({ baselineAtStart: SHA, baselineAtEnd: SHA });
    expect(result.moved).toBe(false);
    expect(result.reason).toContain(SHA);
  });

  it('reports a moved base with both revisions', () => {
    const other = 'ffffffffffffffffffffffffffffffffffffffff';
    const result = baseMovedUnderMission({ baselineAtStart: SHA, baselineAtEnd: other });
    expect(result.moved).toBe(true);
    // The Reviewer reviewed a diff that no longer applies, and the record says
    // exactly which two revisions are involved.
    expect(result.reason).toContain(SHA);
    expect(result.reason).toContain(other);
  });

  it('treats a missing baseline at either end as MOVED, not as unchanged', () => {
    // A check that passes because it could not run is worse than no check: it
    // reads as evidence.
    expect(baseMovedUnderMission({ baselineAtStart: null, baselineAtEnd: SHA }).moved).toBe(true);
    expect(baseMovedUnderMission({ baselineAtStart: SHA, baselineAtEnd: null }).moved).toBe(true);
    expect(baseMovedUnderMission({ baselineAtStart: null, baselineAtEnd: null }).moved).toBe(true);
    expect(baseMovedUnderMission({ baselineAtStart: '  ', baselineAtEnd: SHA }).moved).toBe(true);
  });

  it('says WHICH kind of failure it is, because the two need different fixes', () => {
    /**
     * `moved: true` alone is not enough, and asserting only that is a test that
     * cannot fail. The inequality check below these branches already returns
     * `moved: true` for a null end baseline — `SHA !== null` — so removing the
     * unreadable-baseline branches changes nothing a `.moved` assertion can
     * see. What it changes is the REASON, and the reason is the whole value:
     * "the base moved from X to Y" sends an operator to look at the remote,
     * while "the base could not be read" sends them to look at the worktree.
     * One of those two trips is wasted.
     */
    const unreadableEnd = baseMovedUnderMission({ baselineAtStart: SHA, baselineAtEnd: null });
    expect(unreadableEnd.reason).toContain('could not be read at the end');
    expect(unreadableEnd.reason).not.toContain('moved from');

    const noStart = baseMovedUnderMission({ baselineAtStart: null, baselineAtEnd: SHA });
    expect(noStart.reason).toContain('No baseline was recorded at the start');
    expect(noStart.reason).not.toContain('moved from');

    // And a genuine move still reads as a move.
    const moved = baseMovedUnderMission({ baselineAtStart: SHA, baselineAtEnd: 'f'.repeat(40) });
    expect(moved.reason).toContain('moved from');
  });
});
