import { describe, expect, it } from 'vitest';
import {
  acquireFileClaim, acquireResourceClaim, expireFileClaim, inspectFileClaimConflicts,
  normalizeRepoPath, releaseFileClaim, releaseResourceClaim, renewFileClaim,
} from './claims';
import { deterministicIds, fixedId, makeFileClaim } from '../testing/factories';

const NOW = '2026-07-21T22:30:00.000Z';
const base = () => ({ ids: deterministicIds(), now: NOW, leaseMs: 60_000 });

describe('D — path normalization', () => {
  it('normalizes separators and dot segments; rejects hostile shapes', () => {
    expect(normalizeRepoPath('src\\relay\\./x.ts')).toEqual({ ok: true, value: 'src/relay/x.ts' });
    expect(normalizeRepoPath('a//b/')).toEqual({ ok: true, value: 'a/b' });
    for (const bad of ['', '  ', '/abs/path.ts', 'C:/win/path.ts', '../escape.ts', 'a/../../b', 'nul\0l.ts', './.']) {
      const result = normalizeRepoPath(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('D — file claims', () => {
  it('exclusive write claim; shared reads coexist; read/write and write/write conflict', () => {
    const write = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'a'), path: 'src/x.ts', mode: 'write', existing: [] });
    expect(write.ok).toBe(true);
    if (!write.ok) return;

    const readB = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'b'), path: 'src/x.ts', mode: 'read', existing: [write.value.claim] });
    expect(readB.ok).toBe(false); // read vs exclusive write

    const read1 = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'c'), path: 'src/y.ts', mode: 'read', existing: [] });
    if (!read1.ok) return;
    const read2 = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'd'), path: 'src/y.ts', mode: 'read', existing: [read1.value.claim] });
    expect(read2.ok).toBe(true); // shared reads coexist

    const write2 = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'e'), path: 'src/x.ts', mode: 'write', existing: [write.value.claim] });
    expect(write2.ok).toBe(false); // write/write
  });

  it('parent/child overlap conflicts; disjoint paths do not', () => {
    const parent = makeFileClaim({ taskId: fixedId('tsk', 'a'), path: 'src/dir', mode: 'write' });
    const child = inspectFileClaimConflicts({ taskId: fixedId('tsk', 'b'), path: 'src/dir/leaf.ts', mode: 'write' }, [parent], NOW);
    expect(child).toHaveLength(1);
    expect(child[0].kind).toBe('parent-child');
    const disjoint = inspectFileClaimConflicts({ taskId: fixedId('tsk', 'b'), path: 'src/dirent.ts', mode: 'write' }, [parent], NOW);
    expect(disjoint).toHaveLength(0); // prefix must respect path segments
  });

  it('same-owner reacquisition is idempotent; expired/released claims do not conflict', () => {
    const claim = makeFileClaim({ taskId: fixedId('tsk', 'a') });
    const again = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'a'), path: claim.path, mode: 'write', existing: [claim] });
    expect(again.ok && again.value.idempotent).toBe(true);

    const expired = makeFileClaim({ taskId: fixedId('tsk', 'other'), expiresAt: '2026-07-21T22:00:00.000Z' });
    const afterExpiry = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'b'), path: expired.path, mode: 'write', existing: [expired] });
    expect(afterExpiry.ok).toBe(true);

    const released = makeFileClaim({ taskId: fixedId('tsk', 'other'), status: 'released' });
    const afterRelease = acquireFileClaim({ ...base(), taskId: fixedId('tsk', 'b'), path: released.path, mode: 'write', existing: [released] });
    expect(afterRelease.ok).toBe(true);
  });

  it('lifecycle: renew before expiry, expire at due time, release once', () => {
    const claim = makeFileClaim();
    const renewed = renewFileClaim(claim, NOW, 120_000);
    expect(renewed.ok && renewed.value.expiresAt).toBe('2026-07-21T22:32:00.000Z');
    expect(renewFileClaim({ ...claim, expiresAt: NOW }, NOW, 1000).ok).toBe(false);
    expect(expireFileClaim(claim, NOW).ok).toBe(false); // not due
    expect(expireFileClaim({ ...claim, expiresAt: NOW }, NOW).ok).toBe(true);
    const released = releaseFileClaim(claim, NOW);
    expect(released.ok).toBe(true);
    if (released.ok) expect(releaseFileClaim(released.value, NOW).ok).toBe(false);
  });
});

describe('E — resource claims', () => {
  it('exclusive conflicts, shared coexistence, idempotent reacquisition, explicit keys only', () => {
    const a = acquireResourceClaim({ ...base(), taskId: fixedId('tsk', 'a'), resource: 'migration:0007', mode: 'exclusive', existing: [] });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = acquireResourceClaim({ ...base(), taskId: fixedId('tsk', 'b'), resource: 'migration:0007', mode: 'exclusive', existing: [a.value.claim] });
    expect(b.ok).toBe(false);

    const shared1 = acquireResourceClaim({ ...base(), taskId: fixedId('tsk', 'c'), resource: 'test-env', mode: 'shared', existing: [] });
    if (!shared1.ok) return;
    const shared2 = acquireResourceClaim({ ...base(), taskId: fixedId('tsk', 'd'), resource: 'test-env', mode: 'shared', existing: [shared1.value.claim] });
    expect(shared2.ok).toBe(true);

    const again = acquireResourceClaim({ ...base(), taskId: fixedId('tsk', 'a'), resource: 'migration:0007', mode: 'exclusive', existing: [a.value.claim] });
    expect(again.ok && again.value.idempotent).toBe(true);

    expect(acquireResourceClaim({ ...base(), taskId: fixedId('tsk', 'x'), resource: '  ', mode: 'shared', existing: [] }).ok).toBe(false);

    const released = releaseResourceClaim(a.value.claim);
    expect(released.ok).toBe(true);
  });
});
