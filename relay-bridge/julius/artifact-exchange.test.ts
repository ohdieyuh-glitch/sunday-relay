import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createDurableArtifactExchange, createInMemoryArtifactExchange } from './artifact-exchange';
import { createJuliusDurableArtifacts } from './durable-artifacts';
import { LocalJuliusArtifactStore } from '../../src/relay/workspace/julius-tools/local-artifact-store';
import { createJuliusWorkArtifactMemoryStore } from '../../src/relay/mission/julius';

/**
 * THE LIVE EXCHANGE, ON THE DURABLE STORE.
 *
 * #285 proved the STORE survives a restart. This proves the thing the live
 * mission actually holds is that store and not a map beside it — the gap #285
 * named in its own description and left open on purpose.
 *
 * A "restart" is a NEW exchange over the SAME durable stores: nothing of the
 * first process in memory, everything it wrote still on disk.
 */

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const world = () => {
  const root = mkdtempSync(join(tmpdir(), 'julius-exchange-'));
  roots.push(root);
  const content = new LocalJuliusArtifactStore(root);
  const records = createJuliusWorkArtifactMemoryStore();
  let clock = 0;
  return {
    /** A process. Restarting means calling this again over the same two stores. */
    process: () => createDurableArtifactExchange({
      projectId: 'prj-1',
      artifacts: createJuliusDurableArtifacts({ content, records, tenancy: { tenantId: 'tenant-1' } }),
      now: () => new Date(Date.UTC(2026, 8, 23, 0, 0, clock++)).toISOString(),
    }),
  };
};

const PLAN = JSON.stringify({ objective: 'Normalize the slug.' });
const DIFF_ONE = 'diff --git a/src/a.ts b/src/a.ts\n-const a = 1;\n+const a = 2;\n';

const attempt = (over: Record<string, unknown> = {}) => ({
  kind: 'PLAN' as const, runId: 'run-1', taskId: 'plan-1', leaseGeneration: 1, ...over,
});

describe('a body outlives the process that wrote it', () => {
  it('resolves in a process that never wrote it', async () => {
    const durable = world();
    await durable.process().put({ ...attempt(), role: 'PROMPT_ARCHITECT' }, PLAN);

    // The process dies. Nothing of it is in memory any more.
    expect(await durable.process().get(attempt()), 'the plan a resumed run reads').toBe(PLAN);
  });

  it('is scoped so tightly that a neighbouring attempt, task, run or kind is NOT it', async () => {
    const durable = world();
    await durable.process().put({ ...attempt(), role: 'PROMPT_ARCHITECT' }, PLAN);
    const resumed = durable.process();

    expect(await resumed.get(attempt({ leaseGeneration: 2 })), 'another attempt').toBeNull();
    expect(await resumed.get(attempt({ taskId: 'plan-2' })), 'another task').toBeNull();
    expect(await resumed.get(attempt({ runId: 'run-2' })), 'another run').toBeNull();
    expect(await resumed.get(attempt({ kind: 'DIFF' })), 'another kind').toBeNull();
  });
});

describe('a repair round does not destroy the round that explains it', () => {
  it('keeps both attempts, and a failed capture is ABSENT rather than answered with the last one', async () => {
    const durable = world();
    const process = durable.process();

    // Round one captured a diff. Round two ran and captured nothing.
    await process.put({ kind: 'DIFF', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1, role: 'CODING_AGENT' }, DIFF_ONE);

    const resumed = durable.process();
    expect(
      await resumed.get({ kind: 'DIFF', runId: 'run-1', taskId: 'build-1', leaseGeneration: 2 }),
      'THE WHOLE POINT: round two wrote nothing, so round two HAS nothing',
    ).toBeNull();
    expect(
      await resumed.get({ kind: 'DIFF', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1 }),
      'and round one, which explains why round two exists, is still readable',
    ).toBe(DIFF_ONE);
  });
});

describe('the cap is still enforced', () => {
  it('truncates a runaway body rather than committing it whole', async () => {
    const durable = world();
    const huge = 'x'.repeat(300 * 1024);
    await durable.process().put({ ...attempt({ kind: 'TEST_OUTPUT' }), role: 'CODING_AGENT' }, huge);
    const stored = await durable.process().get(attempt({ kind: 'TEST_OUTPUT' }));
    expect(stored?.length, 'ARTIFACT_TEXT_CAP, unchanged from the map it replaced').toBe(256 * 1024);
  });
});

describe('the in-memory exchange used by adapter proofs', () => {
  it('is keyed by the SAME identity, so an adapter proof cannot pass on a body the durable one would not answer', async () => {
    /**
     * Written because the obvious hand-rolled fake — a map keyed by kind — is
     * exactly the per-run exchange this change removed, and every
     * attempt-exactness proof in the suite would pass against it.
     */
    const memory = createInMemoryArtifactExchange();
    memory.seed({ kind: 'DIFF', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1, role: 'CODING_AGENT' }, DIFF_ONE);

    expect(await memory.get({ kind: 'DIFF', runId: 'run-1', taskId: 'build-1', leaseGeneration: 1 })).toBe(DIFF_ONE);
    expect(await memory.get({ kind: 'DIFF', runId: 'run-1', taskId: 'build-1', leaseGeneration: 2 }), 'another attempt').toBeNull();
    expect(await memory.get({ kind: 'DIFF', runId: 'run-2', taskId: 'build-1', leaseGeneration: 1 }), 'another run').toBeNull();
  });
});
