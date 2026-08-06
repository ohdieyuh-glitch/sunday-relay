import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  acquireRunLock, inspectLock, reclaimClassifiedStaleLock, LOCK_FILE, type LockOwner,
} from './lock';

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

  it('the unrestorable case refuses the acquisition and preserves the evidence', () => {
    const dir = tmp();
    const stale = deadOwner();
    writeLock(dir, stale);
    const losersView = inspectLock(dir);

    // The loser quarantines a LIVE lock (the winner's)…
    const winner = acquireRunLock(dir, 'winner', () => '2026-08-06T00:01:00.000Z');
    expect(winner.ok).toBe(true);
    const quarantine = `${LOCK_FILE}.stale-race-3`;
    const { renameSync } = require('node:fs') as typeof import('node:fs');
    renameSync(join(dir, LOCK_FILE), join(dir, quarantine));
    // …a third lock occupies the path in the restore window…
    const third: LockOwner = {
      pid: process.pid, hostname: hostname(),
      acquiredAt: '2026-08-06T00:02:00.000Z', purpose: 'third',
    };
    writeLock(dir, third);
    // …so the no-clobber restore of the quarantined live lock must REFUSE —
    // a rename here would displace the third lock and repeat the bug. This
    // drives the restore step directly: link(quarantine → occupied path).
    const { linkSync } = require('node:fs') as typeof import('node:fs');
    expect(() => linkSync(join(dir, quarantine), join(dir, LOCK_FILE))).toThrow();
    // The evidence survives for diagnosis.
    expect(existsSync(join(dir, quarantine))).toBe(true);
    expect((JSON.parse(readFileSync(join(dir, quarantine), 'utf8')) as LockOwner).purpose)
      .toBe('winner');
    void losersView;
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
