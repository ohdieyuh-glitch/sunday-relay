import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusTimelinePostgresRepository } from './julius-timeline-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import type { JuliusOperationalEvent } from '../mission/julius';
import { juliusRestoreRequestFor } from '../mission/julius/julius-workspace-attribution';

/**
 * ATTEMPT ATTRIBUTION ON THE REAL SCHEMA.
 *
 * The in-memory store models append-only events; this holds the claims that
 * cross the store boundary against the SQL production runs. Each attempt's
 * record is its own row, keyed by an id no other attempt can take: a second
 * attempt cannot overwrite the first, a replay writes nothing twice, and a read
 * for one task or one run never sees another's — which is what makes the
 * restore decision reconstructable by a process that did not write it.
 *
 * Runs wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and DATABASE_URL
 * point at a PostgreSQL — the `first-live-topology` job — and is `todo`
 * elsewhere. No provider is involved.
 */

const enabled = process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1';
const suite = enabled ? describe : describe.todo;

suite('Coding Agent attempt attribution on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-attempt-${nonce}`;
  const mission = `mission-attempt-${nonce}`;
  const runA = `run:attempt-a-${nonce}`;
  const runB = `run:attempt-b-${nonce}`;
  const TREE = (seed: string): string => seed.repeat(40).slice(0, 40);
  let pool: Pool;
  let events: JuliusEventPostgresRepository;
  let timeline: JuliusTimelinePostgresRepository;

  const attemptEvent = (input: {
    runId: string; taskId: string; attempt: number; leaseGeneration: number;
    outcome: 'SUCCEEDED' | 'FAILED'; startTree: string; endTree: string; ownScopeViolations?: number;
  }): JuliusOperationalEvent => ({
    eventId: `event:coder.attempt.workspace:${input.runId}:${input.taskId}:${String(input.leaseGeneration)}`,
    runId: input.runId, projectId: project, type: 'coder.attempt.workspace',
    taskId: input.taskId, workerId: 'coder', correlationId: `corr:${nonce}`, causationId: null,
    occurredAt: new Date().toISOString(),
    facts: {
      attemptOutcome: input.outcome, attempt: input.attempt, leaseGeneration: input.leaseGeneration,
      captured: true, cleanliness: 'OBSERVED_CHANGED', uncapturedReason: null,
      baseTree: TREE('b'), startTree: input.startTree, endTree: input.endTree,
      ownPaths: 1, inheritedPaths: 0, cumulativePaths: 1,
      ownScopeViolations: input.ownScopeViolations ?? 0, truncated: false,
      own: 'src/a.ts', inherited: '', restoreOutcome: null,
    },
  });

  const attemptsFor = async (runId: string, taskId: string) => {
    const rows: Record<string, string | number | boolean | null>[] = [];
    let sinceSequence = 0;
    for (;;) {
      const page = await timeline.timeline({ runId, projectId: project, sinceSequence, limit: 100 });
      for (const entry of page.entries) {
        sinceSequence = Math.max(sinceSequence, entry.sequence);
        if (entry.type === 'coder.attempt.workspace' && entry.taskId === taskId) rows.push(entry.facts);
      }
      if (!page.hasMore || page.entries.length === 0) break;
    }
    return rows;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await new TransactionalWonderlandDatabase(pool).migrate();
    events = new JuliusEventPostgresRepository(pool);
    timeline = new JuliusTimelinePostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `attempt:${nonce}`],
    );
    for (const runId of [runA, runB]) {
      await pool.query(
        "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','attempt','card',1,0)",
        [runId, mission, project],
      );
    }
  });

  afterAll(async () => {
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.outbox o USING relay_wonderland.events e WHERE o.event_id=e.event_id AND e.project_id=$1',
      'DELETE FROM relay_wonderland.events WHERE project_id=$1',
      'DELETE FROM relay_wonderland.stream_sequences WHERE stream_id IN (SELECT run_id FROM relay_wonderland.julius_runs WHERE project_id=$1)',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const sql of statements) {
      await pool.query(sql, [project]).catch(() => undefined);
    }
    await pool?.end().catch(() => undefined);
  });

  it('two attempts of one task are two rows: the second cannot overwrite the first', async () => {
    const first = await events.append(attemptEvent({
      runId: runA, taskId: 'build-1', attempt: 1, leaseGeneration: 1,
      outcome: 'FAILED', startTree: TREE('b'), endTree: TREE('1'), ownScopeViolations: 2,
    }));
    const second = await events.append(attemptEvent({
      runId: runA, taskId: 'build-1', attempt: 2, leaseGeneration: 2,
      outcome: 'SUCCEEDED', startTree: TREE('1'), endTree: TREE('2'),
    }));
    expect([first.recorded, second.recorded]).toEqual([true, true]);
    expect(second.sequence).toBeGreaterThan(first.sequence);

    const rows = await attemptsFor(runA, 'build-1');
    expect(rows.map((facts) => facts.attempt)).toEqual([1, 2]);
    expect(rows.map((facts) => facts.endTree)).toEqual([TREE('1'), TREE('2')]);
    expect(rows.map((facts) => facts.leaseGeneration)).toEqual([1, 2]);
  });

  it('a process that did not write them reaches the same undo decision from the rows alone', async () => {
    const rows = await attemptsFor(runA, 'build-1');
    const last = rows[rows.length - 1]!;
    // The last attempt succeeded, so there is nothing to undo.
    expect(juliusRestoreRequestFor({
      lastAttempt: {
        outcome: last.attemptOutcome === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
        scopeViolations: Number(last.ownScopeViolations),
        startTree: String(last.startTree), endTree: String(last.endTree),
      },
    })).toBeNull();
    // Read as of the first attempt alone, the refused edits are exactly what the undo names.
    const first = rows[0]!;
    expect(juliusRestoreRequestFor({
      lastAttempt: {
        outcome: 'FAILED', scopeViolations: Number(first.ownScopeViolations),
        startTree: String(first.startTree), endTree: String(first.endTree),
      },
    })).toEqual({ startTree: TREE('b'), endTree: TREE('1') });
  });

  it('a replayed attempt record writes one row, not two', async () => {
    const replay = await events.append(attemptEvent({
      runId: runA, taskId: 'build-1', attempt: 2, leaseGeneration: 2,
      outcome: 'SUCCEEDED', startTree: TREE('1'), endTree: TREE('2'),
    }));
    expect(replay.recorded, 'the same attempt is already on the record').toBe(false);
    expect(await attemptsFor(runA, 'build-1')).toHaveLength(2);
  });

  it('another task and another run in the same database never reach this task\'s attribution', async () => {
    await events.append(attemptEvent({
      runId: runA, taskId: 'build-2', attempt: 1, leaseGeneration: 1,
      outcome: 'FAILED', startTree: TREE('7'), endTree: TREE('8'), ownScopeViolations: 1,
    }));
    await events.append(attemptEvent({
      runId: runB, taskId: 'build-1', attempt: 1, leaseGeneration: 1,
      outcome: 'FAILED', startTree: TREE('c'), endTree: TREE('d'), ownScopeViolations: 3,
    }));
    expect((await attemptsFor(runA, 'build-1')).map((facts) => facts.endTree)).toEqual([TREE('1'), TREE('2')]);
    expect((await attemptsFor(runA, 'build-2')).map((facts) => facts.endTree)).toEqual([TREE('8')]);
    expect((await attemptsFor(runB, 'build-1')).map((facts) => facts.endTree)).toEqual([TREE('d')]);
  });
});
