import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createJuliusDurableArtifacts } from './durable-artifacts';
import { LocalJuliusArtifactStore } from '../../src/relay/workspace/julius-tools/local-artifact-store';
import { createJuliusWorkArtifactMemoryStore, JuliusWorkArtifactConflict, juliusWorkArtifactRef } from '../../src/relay/mission/julius';

/**
 * A BODY THAT SURVIVES THE PROCESS THAT MADE IT.
 *
 * Every case here is written against the REAL content store — the one with
 * staged-then-finalize ordering, a digest checked on write and re-checked on
 * read, and a scope it refuses to cross — on a real temporary directory. The
 * only thing faked is the metadata table, and it keeps the same rules the
 * PostgreSQL one does.
 *
 * A "restart" is a NEW exchange built over the SAME durable stores, which is
 * what a restarted process finds: nothing of the first process in memory, and
 * everything it wrote still on disk.
 */

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const PLAN = JSON.stringify({ objective: 'Normalize the slug.', steps: ['read', 'write'] });
const DIFF_A = 'diff --git a/src/a.ts b/src/a.ts\n-const a = 1;\n+const a = 2;\n';
const TESTS_A = 'exit=1\nFAIL src/a.test.ts\n  expected 2 to be 3\n';
const DIFF_B = 'diff --git a/src/a.ts b/src/a.ts\n-const a = 2;\n+const a = 3;\n';
const TESTS_B = 'exit=0\nPASS src/a.test.ts\n';

/** One durable world: a real content store on disk, and the record of what is in it. */
const world = () => {
  const root = mkdtempSync(join(tmpdir(), 'julius-artifacts-'));
  roots.push(root);
  const content = new LocalJuliusArtifactStore(root);
  const records = createJuliusWorkArtifactMemoryStore();
  return {
    content, records, root,
    /** A process. Restarting means calling this again over the same two stores. */
    process: () => createJuliusDurableArtifacts({ content, records, tenancy: { tenantId: 'tenant-1' } }),
  };
};

const scope = (over: Partial<Parameters<ReturnType<typeof world>['process']> extends never ? never : never> | Record<string, unknown> = {}) => ({
  projectId: 'prj-1', runId: 'run-1', taskId: 'plan-1', leaseGeneration: 1,
  kind: 'PLAN' as const, role: 'PROMPT_ARCHITECT', occurredAt: '2026-09-23T00:00:00.000Z',
  ...over,
});

describe('1. a plan outlives the process that wrote it', () => {
  it('resolves by its durable reference after a restart', async () => {
    const durable = world();

    const written = await durable.process().put(scope(), PLAN);
    expect(written.ref, 'the reference an evidence row may carry').toBe(juliusWorkArtifactRef(scope()));
    expect(written.contentHash).toMatch(/^[0-9a-f]{64}$/u);

    // The process dies. Nothing of it is in memory any more.
    const restarted = durable.process();
    expect(await restarted.get(scope()), 'the same bytes, from a process that never wrote them').toBe(PLAN);
    expect(await restarted.latest({ projectId: 'prj-1', runId: 'run-1', taskId: 'plan-1', kind: 'PLAN' })).toBe(PLAN);
  });

  it('is nothing at all when nothing was written, rather than an empty body', async () => {
    const durable = world();
    expect(await durable.process().get(scope())).toBeNull();
    expect(await durable.process().latest({ projectId: 'prj-1', runId: 'run-1', taskId: 'plan-1', kind: 'PLAN' })).toBeNull();
  });
});

describe('2. a reviewer gets exactly the bytes Julius recorded', () => {
  it('retrieves the diff and the test output after a restart', async () => {
    const durable = world();
    const build = { projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', leaseGeneration: 4, role: 'CODING_AGENT', occurredAt: '2026-09-23T00:01:00.000Z' };
    const writer = durable.process();
    await writer.put({ ...build, kind: 'DIFF' }, DIFF_A);
    await writer.put({ ...build, kind: 'TEST_OUTPUT' }, TESTS_A);

    const reviewer = durable.process();
    expect(await reviewer.get({ ...build, kind: 'DIFF' }), 'byte for byte').toBe(DIFF_A);
    expect(await reviewer.get({ ...build, kind: 'TEST_OUTPUT' })).toBe(TESTS_A);
  });
});

describe('3. a repair does not destroy the evidence that explains it', () => {
  it('keeps attempt 1 whole after attempt 2 writes its own', async () => {
    const durable = world();
    const task = { projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', role: 'CODING_AGENT' };
    const first = { ...task, leaseGeneration: 1, occurredAt: '2026-09-23T00:01:00.000Z' };
    const second = { ...task, leaseGeneration: 2, occurredAt: '2026-09-23T00:02:00.000Z' };

    const attemptOne = durable.process();
    await attemptOne.put({ ...first, kind: 'DIFF' }, DIFF_A);
    await attemptOne.put({ ...first, kind: 'TEST_OUTPUT' }, TESTS_A);

    // The review finds a defect, and the repair round runs.
    const attemptTwo = durable.process();
    await attemptTwo.put({ ...second, kind: 'DIFF' }, DIFF_B);
    await attemptTwo.put({ ...second, kind: 'TEST_OUTPUT' }, TESTS_B);

    const later = durable.process();
    expect(await later.get({ ...first, kind: 'DIFF' }), 'the diff that was wrong still stands').toBe(DIFF_A);
    expect(await later.get({ ...first, kind: 'TEST_OUTPUT' }), 'and the failure that proved it').toBe(TESTS_A);
    expect(await later.get({ ...second, kind: 'DIFF' })).toBe(DIFF_B);
    expect(await later.get({ ...second, kind: 'TEST_OUTPUT' })).toBe(TESTS_B);

    // And "the diff" means the latest round, without erasing the earlier one.
    expect(await later.latest({ projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', kind: 'DIFF' })).toBe(DIFF_B);
    expect(durable.records.all().filter((record) => record.kind === 'DIFF'), 'two rounds, two records').toHaveLength(2);
  });

  it('gives the two rounds different references, which is what keeps them apart', () => {
    const first = juliusWorkArtifactRef({ projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1, kind: 'DIFF' });
    const second = juliusWorkArtifactRef({ projectId: 'prj-1', runId: 'run-1', taskId: 'build-1', leaseGeneration: 2, kind: 'DIFF' });
    expect(first).not.toBe(second);
    expect(first, 'and the attempt is visible in the name').toContain('g1');
    expect(second).toContain('g2');
  });
});

describe('the scope the content store itself keeps', () => {
  /**
   * The record separates attempts by artifact id; the CONTENT store separates
   * them again by its own scope, and refuses a read whose scope does not
   * match what it stored. Two layers on purpose: a record that lost the
   * attempt would still be caught by the bytes it asked for.
   */
  it('names the tenant and the attempt on the stored body, not only in the record', async () => {
    const durable = world();
    await durable.process().put({ ...scope(), leaseGeneration: 7 }, PLAN);
    const [record] = durable.records.all();
    const stored = await durable.content.get({
      artifactId: record!.artifactId, tenantId: 'tenant-1', projectId: 'prj-1',
      runId: 'run-1', taskId: 'plan-1', invocationId: 'attempt:7',
    });
    expect(stored, 'the body is filed under the attempt that made it').not.toBeNull();
    expect(stored!.metadata.invocationId).toBe('attempt:7');
    expect(stored!.metadata.tenantId).toBe('tenant-1');
  });

  it('refuses a read that names the wrong attempt', async () => {
    const durable = world();
    await durable.process().put({ ...scope(), leaseGeneration: 7 }, PLAN);
    const [record] = durable.records.all();
    await expect(durable.content.get({
      artifactId: record!.artifactId, tenantId: 'tenant-1', projectId: 'prj-1',
      runId: 'run-1', taskId: 'plan-1', invocationId: 'attempt:8',
    })).rejects.toThrow(/artifact_scope_mismatch/u);
  });
});

describe('what the store refuses', () => {
  it('refuses a second, different body under one attempt rather than replacing the first', async () => {
    const durable = world();
    const process = durable.process();
    await process.put(scope(), PLAN);
    await expect(process.put(scope(), 'a different plan')).rejects.toBeInstanceOf(JuliusWorkArtifactConflict);
    expect(await process.get(scope()), 'the first body stands').toBe(PLAN);
  });

  it('is idempotent for the same body written twice', async () => {
    const durable = world();
    const process = durable.process();
    const first = await process.put(scope(), PLAN);
    const again = await process.put(scope(), PLAN);
    expect(again.ref).toBe(first.ref);
    expect(again.contentHash).toBe(first.contentHash);
    expect(durable.records.all()).toHaveLength(1);
  });

  it('will not hand one tenant another tenant’s body, and tells it nothing', async () => {
    const durable = world();
    await durable.process().put(scope(), PLAN);

    const other = createJuliusDurableArtifacts({ content: durable.content, records: durable.records, tenancy: { tenantId: 'tenant-2' } });
    // NOT an error: an error would be an existence oracle. The other tenant's
    // bytes live under a different scope entirely, so the honest answer is the
    // same one it would get for an artifact that never existed.
    expect(await other.get(scope()), 'nothing, and no hint that there is something').toBeNull();
    expect(await other.latest({ projectId: 'prj-1', runId: 'run-1', taskId: 'plan-1', kind: 'PLAN' })).toBeNull();

    expect(await durable.process().get(scope()), 'while the owner still reads it').toBe(PLAN);
  });

  it('refuses a body the record does not vouch for, rather than returning it', async () => {
    const durable = world();
    await durable.process().put(scope(), PLAN);
    // A record that says the bytes are something else: the row and the body
    // disagree, and the reader must not choose a winner.
    const lying = createJuliusWorkArtifactMemoryStore();
    const [record] = durable.records.all();
    await lying.recordWorkArtifact({ ...record!, contentHash: 'f'.repeat(64) });
    const reader = createJuliusDurableArtifacts({ content: durable.content, records: lying, tenancy: { tenantId: 'tenant-1' } });
    await expect(reader.get(scope())).rejects.toThrow(/julius_work_artifact_integrity_failure/u);
  });
});
