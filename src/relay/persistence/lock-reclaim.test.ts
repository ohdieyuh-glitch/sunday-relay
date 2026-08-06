import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  acquireRunLock, inspectLock, reclaimClassifiedStaleLock, LOCK_FILE, type LockOwner,
} from './lock';

/**
 * Flag-driven fs interception. A single-threaded test cannot interleave a
 * second process INSIDE a sync call, so the failure injections a real race
 * would provide are staged here: one linkSync refusal (the third lock
 * arriving inside the restore window), one unlinkSync refusal (tidy-up
 * failing after a successful restore), and readFileSync answering ENOENT
 * (the acquirer's fresh lock vanished into a racing quarantine). Every flag
 * fires once and passes through otherwise.
 */
const fsFlags = {
  failNextLink: false,
  failNextUnlink: false,
  vanishReadsRemaining: 0,
  /** When set, the next lock-file read answers THIS content instead. */
  serveForeignRead: null as string | null,
};
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    linkSync: (...args: Parameters<typeof actual.linkSync>) => {
      if (fsFlags.failNextLink) {
        fsFlags.failNextLink = false;
        const err = new Error('EEXIST: staged third lock') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      return actual.linkSync(...args);
    },
    unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => {
      if (fsFlags.failNextUnlink) {
        fsFlags.failNextUnlink = false;
        const err = new Error('EPERM: staged tidy failure') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return actual.unlinkSync(...args);
    },
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      const isLockFile = String(args[0]).endsWith(`/${LOCK_FILE}`);
      if (fsFlags.vanishReadsRemaining > 0 && isLockFile) {
        fsFlags.vanishReadsRemaining -= 1;
        const err = new Error('ENOENT: staged vanish') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      if (fsFlags.serveForeignRead !== null && isLockFile) {
        const served = fsFlags.serveForeignRead;
        fsFlags.serveForeignRead = null;
        return served;
      }
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
  };
});

/**
 * THE GUARDED STALE RECLAIM.
 *
 * The race being killed: two processes classify one lock stale; the winner
 * quarantines it and creates a fresh LIVE lock; the loser's unconditional
 * rename — justified by a classification that is no longer true — displaces
 * the winner's lock, and both then hold. Both holding is two paid dispatches
 * of one iteration.
 *
 * A real race cannot be scheduled from a test, so the interleaving is staged
 * EXPLICITLY: the loser's stale classification is captured first, the
 * winner's swap happens, and the loser's reclaim is then driven with its
 * outdated classification. What the fix guarantees is that the reclaim
 * VERIFIES WHAT IT TOOK — the classification proposes, the quarantine's
 * contents dispose.
 */

const tmp = (): string => mkdtempSync(join(tmpdir(), 'relay-lock-race-'));

const deadOwner = (): LockOwner => {
  const dead = spawnSync(process.execPath, ['-e', '']);
  if (typeof dead.pid !== 'number') throw new Error('no dead pid');
  return {
    pid: dead.pid,
    hostname: hostname(),
    acquiredAt: '2026-08-06T00:00:00.000Z',
    purpose: 'crashed',
  };
};

const writeLock = (dir: string, owner: LockOwner): void => {
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify(owner));
};

describe('the displacement race, staged deterministically', () => {
  it('a reclaim driven by an OUTDATED stale classification restores the live lock untouched', () => {
    const dir = tmp();
    const stale = deadOwner();
    writeLock(dir, stale);

    // The LOSER classifies first — and the classification is true, now.
    const losersView = inspectLock(dir);
    expect(losersView.status).toBe('stale_owner_dead');

    // The WINNER reclaims and acquires; the path now holds a LIVE lock.
    const winner = acquireRunLock(dir, 'winner', () => '2026-08-06T00:01:00.000Z');
    expect(winner.ok).toBe(true);

    // The loser now acts on its stale view. Before the fix this displaced
    // the winner's live lock and let the loser acquire — both holding.
    const outcome = reclaimClassifiedStaleLock(
      dir, losersView.owner as LockOwner, `${LOCK_FILE}.stale-race-test`,
    );
    expect(outcome.kind).toBe('displacement_restored');

    // The winner's protection is intact, bit for bit.
    if (!winner.ok) throw new Error('unreachable');
    expect(winner.value.lock.stillHeld()).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')) as LockOwner;
    expect(onDisk.pid).toBe(process.pid);
    expect(onDisk.purpose).toBe('winner');
    // And the quarantine evidence is gone — nothing was left half-restored.
    expect(existsSync(join(dir, `${LOCK_FILE}.stale-race-test`))).toBe(false);
  });

  it('a reclaim that takes some OTHER live lock restores exactly what it took', () => {
    // Deeper staging of the same race: by the time the loser acts, the stale
    // lock is long gone and a THIRD process's live lock sits at the path.
    // The loser's rename takes THAT; verification sees it is not the
    // classified stale owner; the no-clobber restore puts it back.
    const dir = tmp();
    const stale = deadOwner();
    writeLock(dir, stale);
    const losersView = inspectLock(dir);
    expect(losersView.status).toBe('stale_owner_dead');

    const third: LockOwner = {
      pid: process.pid, hostname: hostname(),
      acquiredAt: '2026-08-06T00:02:00.000Z', purpose: 'third',
    };
    writeLock(dir, third); // the stale lock's place is taken by a live one

    const outcome = reclaimClassifiedStaleLock(
      dir, losersView.owner as LockOwner, `${LOCK_FILE}.stale-race-2`,
    );
    expect(outcome.kind).toBe('displacement_restored');
    if (outcome.kind !== 'displacement_restored') throw new Error('unreachable');
    expect(outcome.displaced.purpose).toBe('third');
    const onDisk = JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')) as LockOwner;
    expect(onDisk.purpose).toBe('third');
    expect(existsSync(join(dir, `${LOCK_FILE}.stale-race-2`))).toBe(false);
  });

  it('the UNRESTORABLE case, through the real function: loud, evidence preserved', () => {
    // The third lock arrives inside the restore window — staged as one
    // refused link, since no second process can interleave a sync call.
    const dir = tmp();
    const stale = deadOwner();
    writeLock(dir, stale);
    const losersView = inspectLock(dir);
    const winner = acquireRunLock(dir, 'winner', () => '2026-08-06T00:01:00.000Z');
    expect(winner.ok).toBe(true);

    fsFlags.failNextLink = true;
    const outcome = reclaimClassifiedStaleLock(
      dir, losersView.owner as LockOwner, `${LOCK_FILE}.stale-race-3`,
    );
    expect(outcome.kind).toBe('displacement_unrestorable');
    if (outcome.kind !== 'displacement_unrestorable') throw new Error('unreachable');
    expect(outcome.displaced.purpose).toBe('winner');
    // The evidence survives for diagnosis.
    expect(existsSync(join(dir, `${LOCK_FILE}.stale-race-3`))).toBe(true);
    expect((JSON.parse(readFileSync(join(dir, `${LOCK_FILE}.stale-race-3`), 'utf8')) as LockOwner).purpose)
      .toBe('winner');
  });

  it('a restore that RESTORED but could not tidy still reports restored', () => {
    // Mutation check: one try spanning both the link and the tidy-up unlink
    // reported "unrestorable" — work no longer protected — when the lock WAS
    // back. Found in review; the split try is what this pins.
    const dir = tmp();
    const stale = deadOwner();
    writeLock(dir, stale);
    const losersView = inspectLock(dir);
    const winner = acquireRunLock(dir, 'winner', () => '2026-08-06T00:01:00.000Z');
    expect(winner.ok).toBe(true);

    fsFlags.failNextUnlink = true;
    const outcome = reclaimClassifiedStaleLock(
      dir, losersView.owner as LockOwner, `${LOCK_FILE}.stale-race-4`,
    );
    expect(outcome.kind).toBe('displacement_restored');
    // The winner's protection is intact; the quarantine name lingers as a
    // second link to the SAME inode — harmless, and stated harmless.
    if (!winner.ok) throw new Error('unreachable');
    expect(winner.value.lock.stillHeld()).toBe(true);
    expect(existsSync(join(dir, `${LOCK_FILE}.stale-race-4`))).toBe(true);
  });
});

describe('the orphan found in review: a vanished fresh lock is waited out', () => {
  it('accepts its own lock when the guarded restore puts it back within the wait', () => {
    // The acquirer's post-create read answers ENOENT twice — a racing
    // reclaim holds the file in quarantine — and then the restore lands.
    // Mutation check: the pre-repair code failed on the FIRST missing read,
    // leaving the restored live lock with no holder to release it: an
    // orphan refusing every acquirer until this process exited.
    const dir = tmp();
    fsFlags.vanishReadsRemaining = 2;
    const result = acquireRunLock(dir, 'holder', () => '2026-08-06T00:01:00.000Z');
    expect(fsFlags.vanishReadsRemaining).toBe(0);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.lock.stillHeld()).toBe(true);
    result.value.lock.release();
    expect(inspectLock(dir).status).toBe('free');
  });

  it('refuses IMMEDIATELY when the wait meets FOREIGN content — no acceptance, no touching it', () => {
    // The vanish is followed not by our restore but by someone else's lock:
    // the wait must refuse on sight of foreign content, not keep waiting and
    // not accept. Mutation check: a wait that only checks "is something
    // there" accepts the foreign lock and reports a hold it does not have.
    const dir = tmp();
    const foreign: LockOwner = {
      pid: process.pid, hostname: hostname(),
      acquiredAt: '2026-08-06T00:09:00.000Z', purpose: 'foreign', nonce: 'not-ours',
    };
    fsFlags.vanishReadsRemaining = 1;
    fsFlags.serveForeignRead = JSON.stringify(foreign);
    const result = acquireRunLock(dir, 'holder', () => '2026-08-06T00:01:00.000Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('displaced during acquisition');
    // Both staged reads were consumed — the refusal came from the foreign
    // sighting, not from the deadline.
    expect(fsFlags.vanishReadsRemaining).toBe(0);
    expect(fsFlags.serveForeignRead).toBeNull();
  });
});

describe('two acquisitions in one millisecond are two owners', () => {
  it('a stale handle’s second release never unlinks the successor’s lock', () => {
    // Same pid, same purpose, same now() millisecond — before the nonce,
    // the stale handle could not tell the new lock from its own and its
    // second release() unlinked it. Found in review by direct probe.
    const dir = tmp();
    const at = () => '2026-08-06T00:01:00.000Z';
    const h1 = acquireRunLock(dir, 'worker', at);
    expect(h1.ok).toBe(true);
    if (!h1.ok) throw new Error('unreachable');
    h1.value.lock.release();

    const h2 = acquireRunLock(dir, 'worker', at);
    expect(h2.ok).toBe(true);
    if (!h2.ok) throw new Error('unreachable');

    // The stale handle releases AGAIN — it must not touch the new lock.
    h1.value.lock.release();
    expect(h2.value.lock.stillHeld()).toBe(true);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
  });
});

describe('what acquire now refuses', () => {
  it('an UNREADABLE lock fails the acquisition by name — never reclaimed', () => {
    const dir = tmp();
    writeFileSync(join(dir, LOCK_FILE), 'not json at all');
    expect(inspectLock(dir).status).toBe('unreadable');

    const result = acquireRunLock(dir, 'hopeful', () => '2026-08-06T00:01:00.000Z');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('cannot be read');
      expect(result.error.message).toContain('not reclaimed');
    }
    // The unreadable file is EXACTLY where it was — no quarantine, no guess.
    expect(readFileSync(join(dir, LOCK_FILE), 'utf8')).toBe('not json at all');
    expect(readdirSync(dir)).toEqual([LOCK_FILE]);
  });

  it('a legitimate stale reclaim still works end to end, evidence preserved', () => {
    const dir = tmp();
    writeLock(dir, deadOwner());
    const result = acquireRunLock(dir, 'recovery', () => '2026-08-06T00:01:00.000Z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.diagnostics.join(' ')).toMatch(/stale lock/);
      expect(result.value.lock.stillHeld()).toBe(true);
    }
    expect(readdirSync(dir).some((n) => n.startsWith('lock.stale-'))).toBe(true);
  });

  it('stillHeld answers false the moment the lock is not ours, and release touches nothing foreign', () => {
    const dir = tmp();
    const result = acquireRunLock(dir, 'holder', () => '2026-08-06T00:01:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const foreign: LockOwner = {
      pid: process.pid, hostname: hostname(),
      acquiredAt: '2026-08-06T00:05:00.000Z', purpose: 'foreign',
    };
    writeLock(dir, foreign);
    expect(result.value.lock.stillHeld()).toBe(false);
    result.value.lock.release();
    // The foreign lock survives the release untouched.
    expect((JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')) as LockOwner).purpose)
      .toBe('foreign');
  });
});
