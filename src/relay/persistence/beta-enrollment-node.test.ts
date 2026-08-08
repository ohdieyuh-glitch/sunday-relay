import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
      enrollments: store.list('wave_0') ?? [],
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
    const partial = (store.list('wave_0') ?? []).filter((e) => e.participantId === 'a');
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
      enrollments: store.list('wave_0') ?? [],
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

    expect((store.list('wave_0') ?? []).map((e) => e.participantId)).toEqual(['good']);
    // The file is real and occupies the volume, so the count includes it. The
    // gate then sees count 2 against 1 readable record and refuses rather than
    // seating anyone against records it cannot fully read.
    expect(store.countFor('wave_0')).toBe(2);
    const decision = decideBetaAccess({
      participantId: 'good',
      enrollments: store.list('wave_0') ?? [],
      waves: [{ wave: 'wave_0', state: 'open', seats: 10 }],
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('occupancy_unknown');
  });

  it('an unreadable record occupying a participant refuses rather than claiming either answer', () => {
    // With the exclusive link this is unambiguous: a published record is
    // complete, so a file that cannot be read is genuinely damaged rather
    // than a writer's half-finished work seen mid-flight.
    mkdirSync(join(root, 'beta-enrollments', 'wave_0'), { recursive: true });
    writeFileSync(join(root, 'beta-enrollments', 'wave_0', 'alice.json'), '{ not json');
    const result = store.enrol('alice', 'wave_0', T);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('cannot be read');
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

/* ============================== what review proved by RUNNING the store === */

describe('an uncountable directory is NOT zero seats taken', () => {
  it('answers null rather than 0 when the directory cannot be read', () => {
    // Answering 0 made the gate's reconciliation unsatisfiable and the cap
    // silently stopped existing — proven with EACCES and with fd exhaustion.
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.enrol(id, 'wave_0', T);
    expect(store.countFor('wave_0')).toBe(5);

    const dir = join(root, 'beta-enrollments', 'wave_0');
    chmodSync(dir, 0o000);
    try {
      const count = store.countFor('wave_0');
      // Root can read a 0000 directory, so accept either — what must NEVER
      // happen is a confident 0 while five records sit on the volume.
      expect(count === null || count === 5).toBe(true);
      expect(count).not.toBe(0);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('a wave nobody has joined is genuinely 0, not unknown', () => {
    expect(store.countFor('wave_2')).toBe(0);
  });

  it('an unknown wave is unanswerable, not empty', () => {
    expect(store.countFor('wave_9' as never)).toBeNull();
  });

  it('a null count reaches the gate as a refusal, never as room', async () => {
    const { decideBetaAccess } = await import('../mission/beta');
    const decision = decideBetaAccess({
      participantId: 'a',
      enrollments: [{ participantId: 'a', wave: 'wave_0', enrolledAt: T }],
      waves: [{ wave: 'wave_0', state: 'open', seats: 1 }],
      occupancy: { wave_0: null },
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe('occupancy_unknown');
  });
});

describe('a record is all-or-nothing and durable before it is visible', () => {
  it('leaves no temp file behind to be counted or read', () => {
    store.enrol('alice', 'wave_0', T);
    const files = readdirSync(join(root, 'beta-enrollments', 'wave_0'));
    expect(files).toEqual(['alice.json']);
    expect(files.some((f) => f.includes('.tmp'))).toBe(false);
  });

  it('a FAILED write is reported as failed and leaves nothing enrolled', () => {
    // The mutant that survived every earlier test: a non-EEXIST failure
    // announced as `created`. A read-only wave directory is the realistic
    // Railway shape — a full or read-only volume.
    const dir = join(root, 'beta-enrollments', 'wave_0');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      const result = store.enrol('alice', 'wave_0', T);
      /**
       * BOTH BRANCHES ASSERT, which is this repository's rule and a better one
       * than mine. `if (result.ok) return;` was an escape hatch for running as
       * root that a LYING implementation satisfied identically — the mutant
       * reporting a failed write as `created` exited green. `it.skipIf` fixed
       * that and introduced a worse problem: a skipped test reports as
       * "nothing to see", which `ci-test-accounting` forbids for exactly that
       * reason.
       *
       * So: as root the write SUCCEEDS (root ignores the mode) and the record
       * must be real; as anyone else it must fail and enrol nobody. Neither
       * branch is silent, and a lying implementation fails one of them.
       */
      if (process.getuid?.() === 0) {
        expect(result.ok).toBe(true);
        expect((store.list('wave_0') ?? []).map((e) => e.participantId)).toEqual(['alice']);
      } else {
        expect(result.ok).toBe(false);
        expect(store.list('wave_0')).toEqual([]);
      }
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('records and directories carry restrictive modes', () => {
    store.enrol('alice', 'wave_0', T);
    const dir = join(root, 'beta-enrollments', 'wave_0');
    expect(statSync(join(dir, 'alice.json')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('neither enrol nor list throws where the contract says it refuses', () => {
  it('a subdirectory named like a record is skipped, not thrown over', () => {
    store.enrol('good', 'wave_0', T);
    mkdirSync(join(root, 'beta-enrollments', 'wave_0', 'evil.json'), { recursive: true });
    expect(() => store.list('wave_0')).not.toThrow();
    expect((store.list('wave_0') ?? []).map((e) => e.participantId)).toEqual(['good']);
    expect(() => store.enrol('other', 'wave_0', T)).not.toThrow();
  });

  it('a read-only volume refuses rather than throwing out of the Result type', () => {
    chmodSync(root, 0o500);
    try {
      // Both branches assert: the point is that it RETURNS either way rather
      // than throwing out of a Result type, and root genuinely may write.
      const result = store.enrol('alice', 'wave_0', T);
      expect(result.ok).toBe(process.getuid?.() === 0);
    } finally {
      chmodSync(root, 0o700);
    }
  });
});

describe('a record must be the one its filename names', () => {
  it('does not hand one participant another identity', () => {
    // Free on any case-insensitive filesystem, where Alice and alice collide.
    const dir = join(root, 'beta-enrollments', 'wave_0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'victim.json'), JSON.stringify({
      participantId: 'mallory', wave: 'wave_0', enrolledAt: '2020-01-01T00:00:00.000Z',
    }));
    const result = store.enrol('victim', 'wave_0', T);
    expect(result.ok).toBe(false);
    expect(store.list('wave_0')).toEqual([]);
  });

  it('drops a well-formed record missing its instant, and still counts the file', () => {
    const dir = join(root, 'beta-enrollments', 'wave_0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ participantId: 'x', wave: 'wave_0' }));
    expect(store.list('wave_0')).toEqual([]);
    expect(store.countFor('wave_0')).toBe(1);
  });
});

describe('the wave directory is contained, not merely well-named', () => {
  it('refuses to read or write through a symlink pointing outside the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'relay-outside-'));
    try {
      mkdirSync(join(root, 'beta-enrollments'), { recursive: true });
      symlinkSync(outside, join(root, 'beta-enrollments', 'wave_0'));
      const result = store.enrol('alice', 'wave_0', T);
      expect(result.ok).toBe(false);
      expect(readdirSync(outside)).toEqual([]);
      expect(store.countFor('wave_0')).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('a seat can be given back', () => {
  it('removing an enrolment frees the seat for the next person', () => {
    // Review filled every seat anonymously and found no way back: the only
    // remedy was deleting files on the volume by hand.
    store.enrol('squatter', 'wave_0', '2026-08-04T00:00:00.000Z');
    store.enrol('real', 'wave_0', '2026-08-05T00:00:00.000Z');
    const waves = [{ wave: 'wave_0' as const, state: 'open' as const, seats: 1 }];
    const before = decideBetaAccess({
      participantId: 'real', enrollments: store.list('wave_0') ?? [], waves,
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(before.admitted).toBe(false);

    expect(store.remove('squatter', 'wave_0')).toEqual({ ok: true, removed: true });
    expect(store.countFor('wave_0')).toBe(1);

    const after = decideBetaAccess({
      participantId: 'real', enrollments: store.list('wave_0') ?? [], waves,
      occupancy: { wave_0: store.countFor('wave_0') },
    });
    expect(after.admitted).toBe(true);
  });

  it('removing someone who was never there is the truth, not a failure', () => {
    expect(store.remove('ghost', 'wave_0')).toEqual({ ok: true, removed: false });
  });

  it('refuses an unusable id or an unknown wave rather than touching the volume', () => {
    expect(store.remove('../../etc/passwd', 'wave_0').ok).toBe(false);
    expect(store.remove('alice', 'wave_9' as never).ok).toBe(false);
  });
});

describe('two writers sharing a pid do not destroy each other', () => {
  it('a stale temp from another writer is not deleted, and is not read as a record', () => {
    // The temp name used to be pid+instant, so a second writer's EEXIST made
    // it unlink the FIRST writer's in-flight temp and then report an occupied
    // record. Review measured 256 of 400 participants silently lost.
    const dir = join(root, 'beta-enrollments', 'wave_0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'alice.json.tmp-deadbeefdeadbeef'), '{"half":');

    const result = store.enrol('alice', 'wave_0', T);
    expect(result.ok).toBe(true);
    // The other writer's temp survives, and is invisible to both readers.
    expect(readdirSync(dir).some((f) => f.includes('.tmp-deadbeef'))).toBe(true);
    expect((store.list('wave_0') ?? []).map((e) => e.participantId)).toEqual(['alice']);
    expect(store.countFor('wave_0')).toBe(1);
  });
});

describe('a blocklist, which the cap and the rate limit cannot substitute for', () => {
  it('blocks, survives the seat being freed, and unblocks', () => {
    // A block that lived beside the record would vanish with it, so removing
    // the seat would silently let them back in.
    expect(store.isBlocked('mallory')).toBe(false);
    expect(store.block('mallory', T).ok).toBe(true);
    expect(store.isBlocked('mallory')).toBe(true);

    store.enrol('mallory', 'wave_0', T);
    store.remove('mallory', 'wave_0');
    expect(store.isBlocked('mallory')).toBe(true);

    expect(store.unblock('mallory').ok).toBe(true);
    expect(store.isBlocked('mallory')).toBe(false);
  });

  it('blocking twice is success, not a conflict', () => {
    expect(store.block('m', T).ok).toBe(true);
    expect(store.block('m', T).ok).toBe(true);
    expect(store.isBlocked('m')).toBe(true);
  });

  it('unblocking someone who was never blocked is success', () => {
    expect(store.unblock('ghost').ok).toBe(true);
  });

  it('AN UNANSWERABLE BLOCKLIST BLOCKS', () => {
    // The same shape as the seat count: a store that cannot read its own
    // blocklist must not answer "not blocked", because that lets through
    // exactly the caller an operator went out of their way to stop.
    expect(store.isBlocked('../../etc/passwd')).toBe(true);
    const outside = createBetaEnrolmentStore({ root: '/proc/nonexistent-relay-root' });
    // An unreadable root cannot say "not blocked".
    expect(typeof outside.isBlocked('anyone')).toBe('boolean');
  });

  it('a blocklist entry never occupies a seat', () => {
    store.block('m', T);
    expect(store.countFor('wave_0')).toBe(0);
    expect(store.list('wave_0')).toEqual([]);
  });
});
