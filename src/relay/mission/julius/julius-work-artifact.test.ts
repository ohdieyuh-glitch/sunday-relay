import { describe, expect, it } from 'vitest';

import { createJuliusWorkArtifactMemoryStore } from './julius-work-artifact-memory';
import {
  JuliusWorkArtifactConflict,
  juliusWorkArtifactId,
  juliusWorkArtifactRef,
  validateJuliusWorkArtifact,
  type JuliusWorkArtifactRecord,
} from './julius-work-artifact';

/**
 * WHAT MAKES ONE ARTIFACT A DIFFERENT ARTIFACT, AND WHAT A RECORD MUST SAY.
 *
 * The bodies a mission produced used to live in a `Map` keyed per RUN, so a
 * repair round overwrote the round before it — destroying the diff and the
 * test output that explain why the repair was needed. Identity is therefore
 * the attempt: project, run, task, the lease generation that fences it, and
 * the kind.
 */

const DIGEST = 'a'.repeat(64);

const record = (over: Partial<JuliusWorkArtifactRecord> = {}): JuliusWorkArtifactRecord => {
  const scope = {
    projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1,
    kind: 'DIFF' as const, ...over,
  };
  return {
    ...scope,
    artifactId: juliusWorkArtifactId(scope),
    role: 'CODING_AGENT', contentType: 'text/plain; charset=utf-8',
    byteSize: 10, contentHash: DIGEST, storageRef: 'local://a/b/c',
    occurredAt: '2026-09-23T00:00:00.000Z',
    ...over,
  };
};

describe('what makes one artifact a different artifact', () => {
  it('is the attempt: two rounds of one task are two artifacts', () => {
    expect(juliusWorkArtifactId({ projectId: 'p', runId: 'r', taskId: 't', leaseGeneration: 1, kind: 'DIFF' }))
      .not.toBe(juliusWorkArtifactId({ projectId: 'p', runId: 'r', taskId: 't', leaseGeneration: 2, kind: 'DIFF' }));
  });

  it('is the task: two tasks of one run, on the same attempt number, are two artifacts', () => {
    // A run's tasks each have their own lease generations; nothing stops two
    // being at generation 1 at once.
    expect(juliusWorkArtifactId({ projectId: 'p', runId: 'r', taskId: 'build-1', leaseGeneration: 1, kind: 'DIFF' }))
      .not.toBe(juliusWorkArtifactId({ projectId: 'p', runId: 'r', taskId: 'build-2', leaseGeneration: 1, kind: 'DIFF' }));
  });

  it('is the kind: the diff and the test output of one attempt do not collide', () => {
    const scope = { projectId: 'p', runId: 'r', taskId: 't', leaseGeneration: 1 } as const;
    expect(juliusWorkArtifactId({ ...scope, kind: 'DIFF' })).not.toBe(juliusWorkArtifactId({ ...scope, kind: 'TEST_OUTPUT' }));
  });

  it('is the run, so two runs of one task do not share a body', () => {
    expect(juliusWorkArtifactId({ projectId: 'p', runId: 'run-1', taskId: 't', leaseGeneration: 1, kind: 'PLAN' }))
      .not.toBe(juliusWorkArtifactId({ projectId: 'p', runId: 'run-2', taskId: 't', leaseGeneration: 1, kind: 'PLAN' }));
  });

  it('is the same name for the same attempt, so a replay names what it already wrote', () => {
    const scope = { projectId: 'p', runId: 'r', taskId: 't', leaseGeneration: 3, kind: 'PLAN' } as const;
    expect(juliusWorkArtifactId(scope)).toBe(juliusWorkArtifactId({ ...scope }));
    expect(juliusWorkArtifactRef(scope)).toBe(`artifact:${juliusWorkArtifactId(scope)}`);
  });
});

describe('what a record must say to be recordable', () => {
  it('accepts a whole one', () => {
    expect(() => validateJuliusWorkArtifact(record())).not.toThrow();
  });

  it('refuses a body it could never verify', () => {
    expect(() => validateJuliusWorkArtifact(record({ contentHash: DIGEST.slice(0, 16) }))).toThrow('julius_work_artifact_digest_invalid');
    expect(() => validateJuliusWorkArtifact(record({ contentHash: 'not a digest' }))).toThrow('julius_work_artifact_digest_invalid');
  });

  it('refuses a size that is not one', () => {
    for (const byteSize of [-1, 1.5, Number.NaN]) {
      expect(() => validateJuliusWorkArtifact(record({ byteSize })), String(byteSize)).toThrow('julius_work_artifact_size_invalid');
    }
  });

  it('refuses an attempt that is not one', () => {
    for (const leaseGeneration of [-1, 2.5]) {
      // The id is rebuilt from the scope, so the check that fires first is the
      // attempt's own — which is the one that matters.
      expect(() => validateJuliusWorkArtifact(record({ leaseGeneration })), String(leaseGeneration))
        .toThrow(/julius_work_artifact_(attempt_invalid|id_mismatch)/u);
    }
  });

  it('refuses a kind nobody defined', () => {
    expect(() => validateJuliusWorkArtifact(record({ kind: 'SECRETS' as never }))).toThrow('julius_work_artifact_kind_invalid');
  });

  it('refuses an identity with nothing in it', () => {
    for (const over of [{ projectId: '' }, { runId: '  ' }, { taskId: '' }, { role: '' }, { storageRef: '' }, { contentType: '' }, { occurredAt: '' }]) {
      expect(() => validateJuliusWorkArtifact(record(over)), JSON.stringify(over)).toThrow(/julius_work_artifact_(identity_required|id_mismatch)/u);
    }
  });

  it('refuses an id that does not name its own scope — the one a caller could forge', () => {
    expect(() => validateJuliusWorkArtifact({ ...record(), artifactId: 'artifact:something-else' }))
      .toThrow('julius_work_artifact_id_mismatch');
  });
});

describe('the record keeps what it was given', () => {
  it('is idempotent for the same body, and refuses a different one under that id', async () => {
    const store = createJuliusWorkArtifactMemoryStore();
    expect(await store.recordWorkArtifact(record())).toEqual({ recorded: true });
    expect(await store.recordWorkArtifact(record()), 'the same body again').toEqual({ recorded: false });

    await expect(store.recordWorkArtifact(record({ contentHash: 'b'.repeat(64) })))
      .rejects.toBeInstanceOf(JuliusWorkArtifactConflict);
    await expect(store.recordWorkArtifact(record({ byteSize: 11 })), 'a different size is a different body')
      .rejects.toBeInstanceOf(JuliusWorkArtifactConflict);

    expect(store.all(), 'and the first record stands alone').toHaveLength(1);
    expect(store.all()[0]!.contentHash).toBe(DIGEST);
  });

  it('does not hand one project another project’s record', async () => {
    const store = createJuliusWorkArtifactMemoryStore();
    await store.recordWorkArtifact(record());
    const scope = { projectId: 'prj-2', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1, kind: 'DIFF' as const };
    expect(await store.workArtifact(scope), 'a different project asks and is told nothing').toBeNull();
    expect(await store.latestWorkArtifact({ projectId: 'prj-2', runId: 'run-1', taskId: 'build-1', kind: 'DIFF' })).toBeNull();
    expect(await store.workArtifactsForRun({ projectId: 'prj-2', runId: 'run-1' })).toEqual([]);
  });

  it('answers latest with the newest attempt, while the earlier one stays', async () => {
    const store = createJuliusWorkArtifactMemoryStore();
    await store.recordWorkArtifact(record({ leaseGeneration: 1, contentHash: 'c'.repeat(64) }));
    await store.recordWorkArtifact(record({ leaseGeneration: 2, contentHash: 'd'.repeat(64) }));

    const latest = await store.latestWorkArtifact({ projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', kind: 'DIFF' });
    expect(latest?.leaseGeneration).toBe(2);
    const first = await store.workArtifact({ projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1, kind: 'DIFF' });
    expect(first?.contentHash, 'the round that explains the repair is still there').toBe('c'.repeat(64));
    expect(await store.workArtifactsForRun({ projectId: 'prj-1', runId: 'run-1' })).toHaveLength(2);
  });
});
