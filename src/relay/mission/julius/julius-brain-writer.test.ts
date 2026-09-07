import { describe, expect, it } from 'vitest';
import { createJuliusMemoryStore } from './julius-memory-store';
import type { JuliusBrainAppend } from './julius-runtime-ports';

/**
 * THE PROJECT BRAIN'S WRITE SIDE.
 *
 * `julius_brain_entries` has had eight entry kinds and a read path since
 * migration 014, and exactly one writer: the bootstrap seed. Five of those kinds
 * — DECISION, FINDING, REPAIR, RESEARCH_NOTE, HANDOFF — had no producer at all,
 * so what a run LEARNED never survived it. The founder's requirement is that the
 * brain preserve decisions, findings, repairs, research and handoffs; this is
 * the store operation that makes any of that possible.
 *
 * What is worth proving here is not that an append appends. It is the three
 * properties a durable log has to have and an in-memory one can silently lack:
 * revisions are allocated by the STORE and never collide, a replay is a true
 * no-op INCLUDING the counter, and an append to a run that is not there writes
 * nothing rather than inventing one.
 */

const APPEND: Omit<JuliusBrainAppend, 'entryId' | 'kind' | 'safeText'> = {
  runId: 'run-1', projectId: 'prj-1', taskId: 'task-1',
  workerId: 'coding-agent-claude-hosted', evidenceIds: [], occurredAt: '2026-09-07T00:00:00.000Z',
};

function storeWithRun(seeded: readonly { entryId: string; text: string }[] = []) {
  const store = createJuliusMemoryStore();
  store.seedRun({
    runId: 'run-1', missionId: 'mission-1', projectId: 'prj-1', state: 'EXECUTING',
    cardRevision: 'card-1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  if (seeded.length > 0) {
    store.seedBrain('run-1', seeded.map((entry) => ({
      entryId: entry.entryId, kind: 'CONSTRAINT' as const, text: entry.text,
      taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const,
      sensitivity: 'INTERNAL' as const,
    })));
  }
  const append = (entryId: string, kind: JuliusBrainAppend['kind'], safeText: string) =>
    store.appendBrainEntry({ ...APPEND, entryId, kind, safeText });
  return { store, append };
}

describe('appending to the Project Brain', () => {
  it('writes an entry a worker can then read back as context', async () => {
    const { store, append } = storeWithRun();
    expect(await append('brain:decision:1', 'DECISION', 'Chose the executor-routed shell.')).toBe(true);

    const entries = await store.brainEntriesForRun('run-1', 'prj-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryId: 'brain:decision:1', kind: 'DECISION', text: 'Chose the executor-routed shell.',
      taskIds: ['task-1'], sensitivity: 'INTERNAL',
    });
    expect(entries[0]?.allowedRoles, 'readable by the three permanent roles, as the read path returns them')
      .toEqual(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
  });

  it('advances the run\'s own projectBrainRevision, which nothing was advancing before', async () => {
    const { store, append } = storeWithRun();
    expect((await store.loadRun('run-1', 'prj-1'))?.projectBrainRevision).toBe(0);
    await append('brain:1', 'DECISION', 'one');
    await append('brain:2', 'FINDING', 'two');
    expect((await store.loadRun('run-1', 'prj-1'))?.projectBrainRevision,
      'the column IS the counter').toBe(2);
  });

  /**
   * THE SEEDED RUN. The bootstrap writes revisions 1..N and leaves the run row
   * at 0, so a store that started from the run row alone would hand out 1 and
   * collide with the seed under `UNIQUE(run_id, revision)`. PostgreSQL answers
   * this with `GREATEST(project_brain_revision, max(revision))`; the model has to
   * answer it the same way or the two disagree about a number that reaches
   * context snapshots and trajectory rows.
   */
  it('continues the sequence past the bootstrap seed rather than colliding with it', async () => {
    const { store, append } = storeWithRun([
      { entryId: 'run-1:objective', text: 'OBJECTIVE: prove the chain.' },
      { entryId: 'run-1:constraint:0', text: 'CONSTRAINT: edit two files.' },
      { entryId: 'run-1:constraint:1', text: 'CONSTRAINT: add no dependency.' },
    ]);
    await append('brain:first-written', 'DECISION', 'after the seed');
    expect((await store.loadRun('run-1', 'prj-1'))?.projectBrainRevision,
      'three seeded entries, so the first written one is the fourth').toBe(4);
    expect(await store.brainEntriesForRun('run-1', 'prj-1')).toHaveLength(4);
  });

  /**
   * A REPLAY MOVES NOTHING — and the counter is the half that is easy to get
   * wrong. `ON CONFLICT DO NOTHING` alone would swallow the row while the
   * allocation had already happened, leaving a counter that counts retried ticks
   * instead of entries.
   */
  it('makes a replay a true no-op, counter included', async () => {
    const { store, append } = storeWithRun();
    expect(await append('brain:decision:1', 'DECISION', 'first')).toBe(true);
    expect(await append('brain:decision:1', 'DECISION', 'first'), 'the same source, again').toBe(false);
    expect(await append('brain:decision:1', 'FINDING', 'a different body entirely'),
      'the entry id is the key; a changed body does not make it a new entry').toBe(false);

    expect(await store.brainEntriesForRun('run-1', 'prj-1')).toHaveLength(1);
    expect((await store.loadRun('run-1', 'prj-1'))?.projectBrainRevision,
      'and the revision did not drift on the replays').toBe(1);
  });

  it('refuses a run it does not have, and a run belonging to another project', async () => {
    const { store, append } = storeWithRun();
    expect(await store.appendBrainEntry({ ...APPEND, runId: 'no-such-run', entryId: 'x', kind: 'DECISION', safeText: 't' }))
      .toBe(false);
    expect(await store.appendBrainEntry({ ...APPEND, projectId: 'another-project', entryId: 'y', kind: 'DECISION', safeText: 't' }),
      'project scope is checked, not assumed from the run id').toBe(false);
    expect(await append('brain:ok', 'DECISION', 'and the real one still works')).toBe(true);
    expect(await store.brainEntriesForRun('run-1', 'prj-1')).toHaveLength(1);
  });

  it('accepts run-level knowledge that names no task', async () => {
    const { store } = storeWithRun();
    await store.appendBrainEntry({ ...APPEND, taskId: null, entryId: 'brain:run', kind: 'HANDOFF', safeText: 'run-level' });
    expect((await store.brainEntriesForRun('run-1', 'prj-1'))[0]?.taskIds,
      'null is an empty list, never a fabricated task id').toEqual([]);
  });

  /**
   * MUTATION. An implementation that allocated from the entry COUNT rather than
   * from the counter would look right on a fresh run and hand out a duplicate
   * revision the moment a replay or a seed was involved.
   */
  it('MUTATION: allocating from the entry count would collide after a refused replay', async () => {
    const { store, append } = storeWithRun([{ entryId: 'seed', text: 'CONSTRAINT: seeded' }]);
    await append('brain:1', 'DECISION', 'one');
    await append('brain:1', 'DECISION', 'one again');
    await append('brain:2', 'FINDING', 'two');
    const entries = await store.brainEntriesForRun('run-1', 'prj-1');
    expect(entries.map((entry) => entry.entryId), 'three rows: the seed and two writes')
      .toEqual(['seed', 'brain:1', 'brain:2']);
    expect((await store.loadRun('run-1', 'prj-1'))?.projectBrainRevision,
      'the mutant answer is 2 — the count of written entries — and the real one is 3').toBe(3);
  });
});
