import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBetaEnrolmentStore, isUsableParticipantId } from './beta-enrollment-node';
import { decideBetaAccess } from '../mission/beta';

/**
 * WHERE A BETA ENROLMENT LIVES.
 *
 * Two properties carry this module, and both exist because review found the
 * gate compensating for their absence: a second enrolment CANNOT create a
 * second record, and the seat count is read independently of any list a caller
 * assembles.
 */

let root: string;
let store: ReturnType<typeof createBetaEnrolmentStore>;
const T = '2026-08-08T10:00:00.000Z';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-beta-'));
  store = createBetaEnrolmentStore({ root });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('an enrolment is recorded once, and a retry cannot take a second seat', () => {
  it('records the first, and reports the ORIGINAL instant on a retry', () => {
    const first = store.enrol('alice', 'wave_0', T);
    expect(first.ok && first.outcome).toBe('created');

    const retry = store.enrol('alice', 'wave_0', '2026-08-09T00:00:00.000Z');
    expect(retry.ok && retry.outcome).toBe('already_enrolled');
    // The FIRST instant orders the queue. Returning the retry's would move
    // alice's seat, which is what a retried write must never do.
    expect(retry.ok && retry.enrollment.enrolledAt).toBe(T);
    expect(store.countFor('wave_0')).toBe(1);
    expect(store.list('wave_0')).toHaveLength(1);
  });

  it('a retry does not displace anyone else in the queue', () => {
    store.enrol('alice', 'wave_0', '2026-08-04T00:00:00.000Z');
    store.enrol('bob', 'wave_0', '2026-08-05T00:00:00.000Z');
    for (let i = 0; i < 5; i += 1) store.enrol('alice', 'wave_0', '2026-08-09T00:00:00.000Z');

    expect(store.countFor('wave_0')).toBe(2);
    // The gate places bob second, exactly as if the retries never happened.
    const decision = decideBetaAccess({
      participantId: 'bob',
      enrollments: store.list('wave_0'),
      waves: [{ wave: 'wave_0', state: 'open', seats: 1 }],
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('wave_full');
  });
});

describe('the count is INDEPENDENT of the list, which is what the gate needs', () => {
  it('counts what is on the volume, not what a caller assembled', () => {
    for (const id of ['a', 'b', 'c']) store.enrol(id, 'wave_0', T);

    // The caller fetches only one participant's enrolment — the optimisation
    // that used to admit everyone against an unenforced cap. The store's own
    // count still knows there are three, so the gate can catch the mismatch.
    const partial = store.list('wave_0').filter((e) => e.participantId === 'a');
    const decision = decideBetaAccess({
      participantId: 'a',
      enrollments: partial,
      waves: [{ wave: 'wave_0', state: 'open', seats: 10 }],
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) {
      expect(decision.reason).toBe('occupancy_unknown');
      expect(decision.detail).toContain('incomplete');
    }
  });

  it('the complete list and the count agree, and the gate admits', () => {
    for (const id of ['a', 'b', 'c']) store.enrol(id, 'wave_0', T);
    const decision = decideBetaAccess({
      participantId: 'a',
      enrollments: store.list('wave_0'),
      waves: [{ wave: 'wave_0', state: 'open', seats: 10 }],
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(decision.admitted).toBe(true);
  });

  it('an empty wave is genuinely zero, not unknown', () => {
    expect(store.countFor('wave_0')).toBe(0);
    expect(store.list('wave_0')).toEqual([]);
  });
});

describe('what it refuses to store', () => {
  it.each([
    ['a path escape', '../../etc/passwd'],
    ['a separator', 'a/b'],
    ['a dot', 'a.b'],
    ['empty', ''],
  ])('refuses %s as a participant id', (_label, id) => {
    expect(isUsableParticipantId(id)).toBe(false);
    const result = store.enrol(id, 'wave_0', T);
    expect(result.ok).toBe(false);
    expect(store.countFor('wave_0')).toBe(0);
  });

  it('refuses a wave this build does not have', () => {
    const result = store.enrol('alice', 'wave_9' as never, T);
    expect(result.ok).toBe(false);
  });

  it('refuses an enrolment with no instant, because the instant orders the queue', () => {
    expect(store.enrol('alice', 'wave_0', '').ok).toBe(false);
    expect(store.countFor('wave_0')).toBe(0);
  });
});

describe('a corrupt record is skipped, never handed to a decision', () => {
  it('is excluded from the list but still COUNTED on the volume', () => {
    store.enrol('good', 'wave_0', T);
    mkdirSync(join(root, 'beta-enrollments', 'wave_0'), { recursive: true });
    writeFileSync(join(root, 'beta-enrollments', 'wave_0', 'torn.json'), '{ not json');

    expect(store.list('wave_0').map((e) => e.participantId)).toEqual(['good']);
    // The file is real and occupies the volume, so the count includes it. The
    // gate then sees count 2 against 1 readable record and refuses rather than
    // seating anyone against records it cannot fully read.
    expect(store.countFor('wave_0')).toBe(2);
    const decision = decideBetaAccess({
      participantId: 'good',
      enrollments: store.list('wave_0'),
      waves: [{ wave: 'wave_0', state: 'open', seats: 10 }],
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('occupancy_unknown');
  });

  it('an unreadable record occupying a participant refuses rather than claiming either answer', () => {
    mkdirSync(join(root, 'beta-enrollments', 'wave_0'), { recursive: true });
    writeFileSync(join(root, 'beta-enrollments', 'wave_0', 'alice.json'), '{ not json');
    const result = store.enrol('alice', 'wave_0', T);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('unreadable');
  });
});

describe('waves are separate', () => {
  it('the same participant may hold one enrolment in each wave', () => {
    expect(store.enrol('alice', 'wave_0', T).ok).toBe(true);
    expect(store.enrol('alice', 'wave_1', T).ok).toBe(true);
    expect(store.countFor('wave_0')).toBe(1);
    expect(store.countFor('wave_1')).toBe(1);
  });
});
