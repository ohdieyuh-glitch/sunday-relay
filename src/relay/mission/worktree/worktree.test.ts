import { describe, expect, it } from 'vitest';
import {
  WORKTREE_SCHEMA_VERSION,
  type MissionWorktreeRecord,
  type MissionWorktreeRecordDraft,
} from './worktree-contracts';
import {
  claimWorktreeLease,
  readWorktreeRecord,
  sealWorktreeRecord,
  verifyWorktreeChecksum,
  worktreeLeaseAllows,
} from './worktree-record';
import { createMissionWorktreeStore } from './worktree-store';
import { createInMemoryDurableBacking } from '../durable';
import {
  NO_WORKTREE_LABEL,
  WORKTREE_OFFLINE_LABEL,
  WORKTREE_SIMULATED_LABEL,
  abbreviateWorktreePath,
  projectMissionWorktree,
  renderWorktreeStatusLines,
} from './worktree-projection';

/**
 * The canonical mission-worktree record and the ONE projection both surfaces
 * render. Pure — every assertion here holds identically in Node and in the
 * browser.
 */

const NOW = '2026-08-01T12:00:00.000Z';

function draft(overrides: Partial<MissionWorktreeRecordDraft> = {}): MissionWorktreeRecordDraft {
  return {
    schemaVersion: WORKTREE_SCHEMA_VERSION,
    worktreeRef: 'worktree:rly-010:mission-1',
    missionId: 'mission-1',
    projectId: 'rly-010',
    repositoryName: 'sunday-relay',
    repositoryRoot: '/home/founder/sunday-relay',
    baseBranch: 'main',
    baseCommit: 'abc1234567890abc1234567890abc1234567890a',
    missionBranch: 'relay/mission/mission-1',
    worktreePath: '/home/founder/.relay-workspaces/missions/sunday-relay/mission-1',
    state: 'ready',
    createdAt: NOW,
    lastValidatedAt: NOW,
    owner: null,
    expectedHead: 'abc1234567890abc1234567890abc1234567890a',
    actualHead: 'abc1234567890abc1234567890abc1234567890a',
    dirty: false,
    processState: 'none',
    cleanupEligible: false,
    cleanupBlockers: ['mission is not terminal'],
    archived: false,
    interruptionReason: null,
    validationFindings: [
      { check: 'git_registration', ok: true, detail: 'Git registration matches.' },
    ],
    evidenceRefs: ['trace-1'],
    provenance: 'live',
    ...overrides,
  };
}

describe('record sealing and validation', () => {
  it('round-trips through the store', async () => {
    const store = createMissionWorktreeStore(createInMemoryDurableBacking());
    const written = await store.write(draft());
    expect(written.ok).toBe(true);
    const read = await store.read('mission-1');
    expect(read.ok).toBe(true);
    if (!read.ok || written.record === undefined) throw new Error('record must round-trip');
    expect(read.record).toEqual(written.record);
  });

  it('rejects a tampered record', () => {
    const sealed = sealWorktreeRecord(draft());
    expect(verifyWorktreeChecksum(sealed)).toBe(true);
    const tampered = { ...sealed, missionBranch: 'main' };
    expect(verifyWorktreeChecksum(tampered)).toBe(false);
    const result = readWorktreeRecord(tampered);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'corrupt') throw new Error('tampered record must be corrupt');
    expect(result.detail).toContain('checksum');
  });

  it('rejects malformed records and reports a future schema as unsupported', () => {
    for (const bad of [null, 'text', {}, { schemaVersion: WORKTREE_SCHEMA_VERSION }]) {
      expect(readWorktreeRecord(bad).ok).toBe(false);
    }
    const future = { ...sealWorktreeRecord(draft()), schemaVersion: 'relay-mission-worktree.v99' };
    const result = readWorktreeRecord(future);
    if (result.ok || result.reason !== 'unsupported_version') {
      throw new Error('a future record must be reported as unsupported');
    }
    expect(result.detail).toContain('v99');
  });

  it('an unknown dirty state must stay null — never assumed clean', () => {
    const sealed = sealWorktreeRecord(draft({ dirty: null }));
    expect(sealed.dirty).toBeNull();
    const read = readWorktreeRecord(sealed);
    expect(read.ok && read.record.dirty).toBeNull();
  });

  it('re-sealing a stored record does not carry a stale checksum', () => {
    const sealed = sealWorktreeRecord(draft());
    const resealed = sealWorktreeRecord({ ...sealed, state: 'active' });
    expect(verifyWorktreeChecksum(resealed)).toBe(true);
    expect(readWorktreeRecord(resealed).ok).toBe(true);
  });
});

describe('ownership leases', () => {
  it('blocks a different live session and allows takeover once expired', () => {
    const record = sealWorktreeRecord(draft({ owner: claimWorktreeLease('session-a', NOW) }));
    expect(worktreeLeaseAllows(record, 'session-a', NOW)).toBe(true);
    expect(worktreeLeaseAllows(record, 'session-b', NOW)).toBe(false);
    expect(worktreeLeaseAllows(record, 'session-b', '2026-08-01T12:02:00.000Z')).toBe(true);
  });
});

describe('the shared projection', () => {
  it('abbreviates the path so a home directory never reaches a surface', () => {
    const view = projectMissionWorktree(sealWorktreeRecord(draft()));
    expect(view.pathLabel).toBe('…/missions/sunday-relay/mission-1');
    expect(view.pathLabel).not.toContain('/home/');
    expect(abbreviateWorktreePath('/a/b')).toBe('…/a/b');
  });

  it('renders a ready worktree compactly', () => {
    const view = projectMissionWorktree(sealWorktreeRecord(draft()));
    expect(view.present).toBe(true);
    expect(view.summary).toBe('Isolated worktree · Ready');
    expect(view.missionBranch).toBe('relay/mission/mission-1');
    expect(view.cleanLabel).toBe('Clean');
    expect(view.usable).toBe(true);
    expect(view.disclosure).toBeNull();
  });

  it('says No isolated worktree when there is none, and never invents a path', () => {
    const view = projectMissionWorktree(null);
    expect(view.summary).toBe(NO_WORKTREE_LABEL);
    expect(view.pathLabel).toBeNull();
    expect(view.fullPath).toBeNull();
    expect(view.present).toBe(false);
  });

  it('says Not available in offline demo for the static deployment', () => {
    const view = projectMissionWorktree(null, { offline: true });
    expect(view.summary).toBe(WORKTREE_OFFLINE_LABEL);
    expect(view.present).toBe(false);
    expect(view.pathLabel).toBeNull();
  });

  it('labels a simulated worktree', () => {
    const view = projectMissionWorktree(sealWorktreeRecord(draft({ provenance: 'simulated' })));
    expect(view.simulated).toBe(true);
    expect(view.disclosure).toBe(WORKTREE_SIMULATED_LABEL);
  });

  it('an unknown dirty state renders Unknown, never Clean', () => {
    const view = projectMissionWorktree(sealWorktreeRecord(draft({ dirty: null })));
    expect(view.cleanLabel).toBe('Unknown');
  });

  it('surfaces blocking states and their exact blockers', () => {
    const view = projectMissionWorktree(sealWorktreeRecord(draft({
      state: 'cleanup_blocked',
      dirty: true,
      cleanupBlockers: ['uncommitted mission work remains'],
    })));
    expect(view.blocking).toBe(true);
    expect(view.usable).toBe(false);
    expect(view.cleanupLabel).toBe('Blocked');
    expect(view.cleanupBlockers).toEqual(['uncommitted mission work remains']);
  });
});

describe('website and CLI agree', () => {
  it('the CLI lines are derived from the same view the website renders', () => {
    const record = sealWorktreeRecord(draft());
    const view = projectMissionWorktree(record);
    const lines = renderWorktreeStatusLines('mission-1', view).join('\n');
    // Every value in the CLI output comes from the view, unmodified.
    expect(lines).toContain(view.missionBranch as string);
    expect(lines).toContain(view.pathLabel as string);
    expect(lines).toContain(view.stateLabel);
    expect(lines).toContain(view.cleanLabel);
    expect(lines).toContain(view.baseCommit as string);
    // The full path is never printed by status.
    expect(lines).not.toContain('/home/founder');
  });

  it('the CLI states the same absence the website does', () => {
    for (const [options, expected] of [
      [{}, NO_WORKTREE_LABEL],
      [{ offline: true }, WORKTREE_OFFLINE_LABEL],
    ] as const) {
      const view = projectMissionWorktree(null, options);
      expect(renderWorktreeStatusLines('mission-1', view).join('\n')).toContain(expected);
    }
  });

  it('the CLI prints the simulated disclosure', () => {
    const view = projectMissionWorktree(sealWorktreeRecord(draft({ provenance: 'simulated' })));
    expect(renderWorktreeStatusLines('mission-1', view)[1]).toBe(WORKTREE_SIMULATED_LABEL);
  });
});

describe('boundary', () => {
  it('the pure module reaches no git, filesystem, clock or process', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;
    const combined = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .join('\n');
    expect(combined).not.toMatch(/from\s+['"]node:/);
    expect(combined).not.toMatch(/child_process|execFile|spawn\(/);
    expect(combined).not.toMatch(/Date\.now\s*\(|new Date\(\)/);
    expect(combined).not.toMatch(/\bfetch\s*\(|localStorage|indexedDB/);
  });
});

/** A record whose only purpose is proving the type is exported usably. */
export type _RecordShape = MissionWorktreeRecord;
