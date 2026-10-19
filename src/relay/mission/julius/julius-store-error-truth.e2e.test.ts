import { describe, expect, it } from 'vitest';

import { createJuliusHarness, seedRun, task, worker, type JuliusHarness } from './julius-runtime-fixtures';

/**
 * THE SETTLEMENT, THROUGH THE REAL PIPELINE, WHEN THE STORE FAILS AFTER THE ACCEPT.
 *
 * The coordinator's own cases fake the ports. These drive the pipeline's real
 * ports, over the in-memory store, with the store's event append failing like a
 * lost connection for one event type. They pin what the fake ports cannot:
 *
 *   - The commit port writes `budget.settled` and then `worker.effort`. When
 *     the second failed, the coordinator used to RELEASE the reservation, and
 *     the release port wrote a SECOND `budget.settled` for it.
 *     `cost-accounting.tsv` sums every settled row, so the component was
 *     counted twice. Now the commit is repeated as bookkeeping, and each of its
 *     events is composed once, so a repeated write is the same event.
 *   - A settlement that cannot be written at all leaves the dispatch COMPLETED,
 *     and says so on its trajectory row instead of pretending it failed.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], timeoutMs: 30_000 });
const scope = { projectId: 'prj-1' };
const pg = (code: string) => Object.assign(new Error(`driver ${code}`), { code, severity: 'ERROR' });

const setup = (): JuliusHarness => {
  const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
  seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
  return harness;
};

/** The store's event append fails for one event type, for the first `times` writes of it, as a lost connection. */
const failAppends = (harness: JuliusHarness, type: string, times: number): { readonly attempts: () => number } => {
  const store = harness.store as unknown as { appendEvent: (event: { type: string }) => Promise<unknown> };
  const original = store.appendEvent.bind(store);
  let left = times;
  let attempts = 0;
  store.appendEvent = async (event) => {
    if (event.type === type) {
      attempts += 1;
      if (left > 0) { left -= 1; throw pg('08006'); }
    }
    return original(event);
  };
  return { attempts: () => attempts };
};

const ofType = (harness: JuliusHarness, type: string) => harness.store.events().filter((event) => event.type === type);

describe('a store failure after the accept can neither fail the dispatch nor settle it twice', () => {
  it('the effort row fails once after the budget commit: COMPLETED, ONE settlement row, no release', async () => {
    const harness = setup();
    const effort = failAppends(harness, 'worker.effort', 1);
    const report = await harness.loop.tick(scope);

    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(['COMPLETED']);
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(effort.attempts(), 'the commit was repeated as bookkeeping').toBe(2);
    const settled = ofType(harness, 'budget.settled');
    expect(settled, 'cost-accounting.tsv sums every settled row: one reservation, one row').toHaveLength(1);
    expect(settled[0]!.facts.released, 'the completed dispatch settled; nothing was released').toBe(false);
    expect(ofType(harness, 'worker.effort')).toHaveLength(1);
    expect(ofType(harness, 'task.failed'), 'the store says SUCCEEDED, and nothing may say otherwise').toHaveLength(0);
  });

  it('a settlement row that cannot be written at all: COMPLETED, the trajectory says UNRECORDED, and the spend stays counted', async () => {
    const harness = setup();
    const settledWrites = failAppends(harness, 'budget.settled', 3);
    const report = await harness.loop.tick(scope);

    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(['COMPLETED']);
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(settledWrites.attempts(), 'three attempts, then reported rather than thrown').toBe(3);
    expect(ofType(harness, 'budget.settled'), 'a missing row is visible as missing, never as a second release').toHaveLength(0);
    expect(ofType(harness, 'task.failed')).toHaveLength(0);
    const dispatch = harness.store.trajectory().find((row) => row.kind === 'DISPATCH' && row.taskId === 'task-1');
    expect(dispatch?.outcome).toBe('COMPLETED');
    expect(dispatch?.safeFacts).toMatchObject({ settlementUnrecorded: true, completedEventUnrecorded: false, bookkeepingStoreErrorClass: 'connection' });
    // The budget store committed on the first attempt; nothing released it afterwards.
    expect(harness.budget.reservations().map((row) => row.state)).not.toContain('RELEASED');
  });

  it('an ordinary completion carries none of the UNRECORDED facts, so every existing row is unchanged', async () => {
    const harness = setup();
    await harness.loop.tick(scope);
    const dispatch = harness.store.trajectory().find((row) => row.kind === 'DISPATCH' && row.taskId === 'task-1');
    expect(dispatch?.safeFacts).not.toHaveProperty('settlementUnrecorded');
    expect(ofType(harness, 'budget.settled')).toHaveLength(1);
  });
});
