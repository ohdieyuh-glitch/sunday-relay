import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCEPTED_MAIN_ARTIFACT_PREFIX,
  MONOTONICITY_VERDICTS,
  acceptedShasFrom,
  evaluateMainMonotonicity,
} from './julius-main-monotonicity.mjs';

/**
 * THE PROVENANCE GATE CANNOT SEE A RESET.
 *
 * A branch rewound to an older commit that was itself approved answers
 * `provenant`, correctly and uselessly: that tree really was approved once.
 * Telling "moved forward" from "moved back" needs a record of what was accepted
 * before, and these cases are that rule.
 */

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);
const UNRELATED = 'd'.repeat(40);

const artifact = (sha: string, over: Record<string, unknown> = {}) =>
  ({ id: 1, name: `${ACCEPTED_MAIN_ARTIFACT_PREFIX}${sha}`, expired: false, ...over });

/** The passing shape: the tip contains every checkpoint. */
const monotonicity = (over: Record<string, unknown> = {}) => evaluateMainMonotonicity({
  mainSha: NEW,
  mainShaAfter: NEW,
  acceptedShas: [OLD],
  containment: { [OLD]: true },
  ...over,
});

describe('monotonic main', () => {
  it('ordinary forward movement through a reviewed squash passes', () => {
    const result = monotonicity();
    expect(result.verdict).toBe('monotonic');
    expect(result.mainSha).toBe(NEW);
    expect(result.missingShas).toEqual([]);
    expect(result.reason).toContain('contains every accepted checkpoint');
  });

  it('and still passes once several checkpoints have accumulated', () => {
    expect(monotonicity({
      mainSha: NEWER, mainShaAfter: NEWER,
      acceptedShas: [OLD, NEW],
      containment: { [OLD]: true, [NEW]: true },
    }).verdict).toBe('monotonic');
  });

  it('the tip being itself a checkpoint is forward movement, not a regression', () => {
    // Accepting a commit and then checking the same commit must pass: a commit
    // contains itself, and the guard must not require strict advancement.
    expect(monotonicity({
      mainSha: NEW, mainShaAfter: NEW, acceptedShas: [NEW], containment: { [NEW]: true },
    }).verdict).toBe('monotonic');
  });

  it('there is one passing verdict and it is named', () => {
    expect(MONOTONICITY_VERDICTS.filter((name) => name !== 'monotonic'))
      .toEqual(['regressed', 'uninitialized', 'indeterminate']);
  });

  it('is reachable as a gate', () => {
    const scripts = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as
      { scripts: Record<string, string> };
    expect(scripts.scripts['julius:main-monotonicity'])
      .toContain('scripts/julius-main-monotonicity.mjs');
  });
});

describe('what must never be reported as monotonic', () => {
  it('1. an exact rollback to an older commit that was itself accepted', () => {
    // The hazard the provenance gate cannot see. `OLD` is a real, approved,
    // once-accepted commit; resetting to it loses `NEW`, and `NEW` is not
    // contained in `OLD`.
    const rolledBack = evaluateMainMonotonicity({
      mainSha: OLD, mainShaAfter: OLD,
      acceptedShas: [OLD, NEW],
      containment: { [OLD]: true, [NEW]: false },
    });
    expect(rolledBack.verdict).toBe('regressed');
    expect(rolledBack.missingShas).toEqual([NEW]);
    expect(rolledBack.reason).toContain('does not contain');
  });

  it('2. a jump to an unrelated history, direct-pushed', () => {
    // Nothing accepted is contained in it, which is the same fact as a rollback
    // and told apart by which checkpoints are missing.
    const jumped = evaluateMainMonotonicity({
      mainSha: UNRELATED, mainShaAfter: UNRELATED,
      acceptedShas: [OLD, NEW],
      containment: { [OLD]: false, [NEW]: false },
    });
    expect(jumped.verdict).toBe('regressed');
    expect(jumped.missingShas).toEqual([OLD, NEW]);
  });

  it('3. dropping only the newest checkpoint still regresses', () => {
    // The subtle version: the tip is a descendant of the first checkpoint, so a
    // guard that only compared against "some" checkpoint would pass it.
    expect(evaluateMainMonotonicity({
      mainSha: NEW, mainShaAfter: NEW,
      acceptedShas: [OLD, NEWER],
      containment: { [OLD]: true, [NEWER]: false },
    }).verdict).toBe('regressed');
  });

  it('4. a first run with no checkpoint at all', () => {
    // "Nothing to compare against" must not read as "fine so far", or the guard
    // is defeated by deleting history.
    const fresh = monotonicity({ acceptedShas: [], containment: {} });
    expect(fresh.verdict).toBe('uninitialized');
    expect(fresh.reason).toContain('a founder must record one');
    expect(fresh.acceptedShas).toEqual([]);
  });

  it('5. containment that could not be proven is not permission', () => {
    for (const unproven of [undefined, null, 'yes', 1, {}]) {
      const result = monotonicity({ containment: { [OLD]: unproven } });
      expect(result.verdict, String(unproven)).toBe('indeterminate');
      expect(result.unprovenShas).toEqual([OLD]);
    }
    // A checkpoint absent from the containment map is unproven, not contained.
    expect(monotonicity({ containment: {} }).verdict).toBe('indeterminate');
  });

  it('6. a branch that moves while the guard runs', () => {
    const moved = monotonicity({ mainShaAfter: NEWER });
    expect(moved.verdict).toBe('indeterminate');
    expect(moved.reason).toContain('moved');
    expect(monotonicity({ mainShaAfter: undefined }).verdict).toBe('indeterminate');
  });

  it('7. metadata that cannot be read', () => {
    for (const over of [
      { mainSha: undefined }, { mainSha: 'not-a-sha', mainShaAfter: 'not-a-sha' },
      { acceptedShas: undefined }, { acceptedShas: null }, { acceptedShas: ['not-a-sha'] },
      { containment: undefined }, { containment: null }, { containment: [] as unknown },
    ]) {
      expect(monotonicity(over).verdict, JSON.stringify(over).slice(0, 44)).toBe('indeterminate');
    }
  });

  it('a proven-false checkpoint is never softened into merely unproven', () => {
    // Both present: the unprovable one is reported first, because "we could not
    // establish this" and "this is definitely gone" call for different actions
    // and the weaker fact must not be dressed up as the stronger one.
    const mixed = evaluateMainMonotonicity({
      mainSha: NEW, mainShaAfter: NEW,
      acceptedShas: [OLD, NEWER],
      containment: { [OLD]: undefined, [NEWER]: false },
    });
    expect(mixed.verdict).toBe('indeterminate');
    expect(mixed.unprovenShas).toEqual([OLD]);
  });
});

/**
 * THE CHECKPOINT LIST IS READ FROM ARTIFACT NAMES.
 *
 * The commit is in the name so that listing artifacts needs no download, no
 * unzip, and no parsing of anything fetched separately.
 */
describe('reading checkpoints from an artifact list', () => {
  it('finds every non-expired checkpoint and ignores everything else', () => {
    expect(acceptedShasFrom([
      artifact(OLD),
      { id: 2, name: 'julius-live-evidence', expired: false },
      { id: 3, name: 'julius-first-live-attempted', expired: false },
      artifact(NEW),
    ])).toEqual([OLD, NEW]);
  });

  it('an expired checkpoint is not a live one', () => {
    // GitHub deletes artifact content after its retention window. What this must
    // never do is silently become "no checkpoints" and then pass — and it
    // cannot, because no checkpoints is itself a blocking verdict.
    expect(acceptedShasFrom([artifact(OLD, { expired: true })])).toEqual([]);
    expect(evaluateMainMonotonicity({
      mainSha: NEW, mainShaAfter: NEW, acceptedShas: [], containment: {},
    }).verdict).toBe('uninitialized');
  });

  it('duplicate uploads of the same commit are one checkpoint', () => {
    expect(acceptedShasFrom([artifact(OLD, { id: 1 }), artifact(OLD, { id: 2 })])).toEqual([OLD]);
  });

  it('a checkpoint name that is not a full sha makes the whole list unreadable', () => {
    // Not skipped quietly: "one row could not be parsed" is not "there were
    // none", and treating it as none would hand back `uninitialized` for a
    // repository that does have checkpoints.
    for (const bad of ['', 'not-a-sha', OLD.toUpperCase(), `${OLD}x`]) {
      expect(acceptedShasFrom([artifact(OLD), { id: 9, name: `${ACCEPTED_MAIN_ARTIFACT_PREFIX}${bad}`, expired: false }]), bad)
        .toBeNull();
    }
  });

  it('an unreadable list is null, which the rule reports as indeterminate', () => {
    for (const broken of [undefined, null, 'unavailable', 42]) {
      expect(acceptedShasFrom(broken), String(broken)).toBeNull();
    }
    expect(monotonicity({ acceptedShas: acceptedShasFrom(undefined) }).verdict).toBe('indeterminate');
  });

  it('the prefix ends in a hyphen, which is what keeps a neighbour out', () => {
    // `julius-accepted-mainsomething` is a different artifact, not a malformed
    // checkpoint, so it is skipped rather than poisoning the whole list.
    expect(acceptedShasFrom([{ id: 1, name: 'julius-accepted-mainsomething', expired: false }])).toEqual([]);
    expect(acceptedShasFrom([{ id: 1, name: 'not-julius-accepted-main-x', expired: false }])).toEqual([]);
    // A name that DOES claim to be a checkpoint and carries no sha is the
    // malformed case, and that one is refused loudly.
    expect(acceptedShasFrom([{ id: 1, name: `${ACCEPTED_MAIN_ARTIFACT_PREFIX}nonsense`, expired: false }])).toBeNull();
  });
});
