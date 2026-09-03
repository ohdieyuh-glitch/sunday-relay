import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LEASE_INVARIANTS, leaseProtocolFailures, verifyLeaseProtocol, type LeaseScheduler,
} from './julius-lease-protocol';
import { JuliusRunLoop } from './julius-run-loop';
import { createJuliusHarness, seedRun, task, worker, cardPolicy } from './julius-runtime-fixtures';

/**
 * TWO SCHEDULERS, ONE PROTOCOL.
 *
 * Relay has two: `julius_tasks` claims work out of a dependency DAG, and
 * `swarm_workers` claims work out of a bounded parallel fan-out. They were
 * built separately and implement the same lease protocol. This file holds both
 * to it — Julius BEHAVIOURALLY, by driving the invariants, and the swarm
 * STRUCTURALLY, by reading its schema, because no PostgreSQL exists here to
 * drive it against.
 *
 * The two kinds of evidence are labelled rather than blended: a structural
 * match proves the swarm DECLARES the same protocol, and only a behavioural
 * run proves it OBEYS one.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });

/** The Julius task scheduler, behind the shared protocol's four methods. */
function juliusScheduler(): { scheduler: LeaseScheduler; harness: ReturnType<typeof createJuliusHarness> } {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
    card: cardPolicy({ allowedProviders: [CODER.providerId] }),
  });
  seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
  const scheduler: LeaseScheduler = {
    async claim(input) {
      const claims = await harness.store.claimRunnable({ ...input, projectId: 'prj-1' });
      return claims.map((claim) => {
        const row = harness.store.taskRow(claim.taskId)!;
        return {
          subjectId: claim.taskId, leaseOwner: row.leaseOwner,
          leaseGeneration: claim.leaseGeneration, leaseExpiresAt: row.leaseExpiresAt,
          attempt: claim.attempt, active: row.state === 'ACTIVE',
        };
      });
    },
    // Julius claims first and decides second, so its claim is ownership only;
    // `admitTask` is where an execution attempt is spent.
    claimIsAdmission: false,
    // Julius's claim query does not offer an expired lease: the bounded
    // recovery sweep is the one way back, so the harness runs it here.
    reclaimExpired: async (now) => { await harness.store.recoverExpired(now); },
    heartbeat: (input) => harness.store.heartbeat({ ...input, taskId: input.subjectId }),
    complete: (input) => harness.store.finishTask({ ...input, taskId: input.subjectId, state: 'SUCCEEDED' }),
    async read(subjectId) {
      const row = harness.store.taskRow(subjectId);
      return row === null ? null : {
        subjectId, leaseOwner: row.leaseOwner, leaseGeneration: row.leaseGeneration,
        leaseExpiresAt: row.leaseExpiresAt, attempt: row.attempt, active: row.state === 'ACTIVE',
      };
    },
  };
  return { scheduler, harness };
}

describe('the Julius task scheduler obeys the shared lease protocol', () => {
  it('holds every invariant', async () => {
    const { scheduler } = juliusScheduler();
    const results = await verifyLeaseProtocol(scheduler, {
      now: '2026-08-27T00:10:00.000Z',
      expiredAt: '2026-08-27T00:00:00.000Z',
      futureAt: '2026-08-27T12:00:00.000Z',
    });
    expect(results).toHaveLength(LEASE_INVARIANTS.length);
    const failures = leaseProtocolFailures(results);
    expect(failures.map((failure) => `${failure.invariant}: ${failure.detail}`)).toEqual([]);
  });

  it('reports every failure rather than stopping at the first', async () => {
    // A scheduler with no locking at all breaks several invariants; the
    // harness must name all of them, because a run that stops at the first is
    // a bisect rather than a report.
    const broken: LeaseScheduler = {
      async claim(input) {
        return [{ subjectId: 's', leaseOwner: input.owner, leaseGeneration: 1, leaseExpiresAt: input.leaseExpiresAt, attempt: 1, active: true }];
      },
      async heartbeat() { return true; },
      async complete() { return true; },
      async read() { return null; },
    };
    const results = await verifyLeaseProtocol(broken, {
      now: '2026-08-27T00:10:00.000Z', expiredAt: '2026-08-27T00:00:00.000Z', futureAt: '2026-08-27T12:00:00.000Z',
    });
    expect(leaseProtocolFailures(results).length).toBeGreaterThan(3);
  });

  it('declares the invariants exactly once each', () => {
    expect(new Set(LEASE_INVARIANTS).size).toBe(LEASE_INVARIANTS.length);
  });
});

/* ------------------------------------------------- the swarm, structurally */

describe('the Wonderland swarm scheduler declares the same protocol', () => {
  const migrations = join(__dirname, '..', '..', 'persistence', 'wonderland-migrations');
  const swarm = readFileSync(join(migrations, '008_wonderland_swarm_scheduler.sql'), 'utf8');
  const julius = readFileSync(join(migrations, '011_julius_runtime.sql'), 'utf8');

  it('carries the same five lease columns', () => {
    for (const column of ['lease_owner', 'lease_generation', 'lease_expires_at', 'last_heartbeat', 'attempt']) {
      expect(swarm, `swarm is missing ${column}`).toContain(column);
      expect(julius, `julius is missing ${column}`).toContain(column);
    }
  });

  it('ties the held state to the owner with a CHECK in both', () => {
    // The invariant "held implies an owner" is enforced by the schema in both,
    // which is why neither can be left in a half-claimed state by a bug.
    expect(swarm).toMatch(/CHECK\(\(state IN\('CLAIMED','STARTING','RUNNING'\)\)=\(lease_owner IS NOT NULL\)\)/);
    expect(julius).toMatch(/CHECK\(\(state='ACTIVE'\)=\(lease_owner IS NOT NULL\)\)/);
  });

  it('indexes the claim path the same way in both', () => {
    expect(swarm).toContain('wonderland_swarm_worker_claim');
    expect(julius).toContain('julius_task_claim');
  });

  it('claims with FOR UPDATE SKIP LOCKED in both implementations', () => {
    const persistence = join(__dirname, '..', '..', 'persistence');
    const wonderland = readFileSync(join(persistence, 'wonderland-postgres.ts'), 'utf8');
    const juliusRepo = readFileSync(join(persistence, 'julius-postgres.ts'), 'utf8');
    for (const [name, text] of [['swarm', wonderland], ['julius', juliusRepo]] as const) {
      expect(text, `${name} does not claim with SKIP LOCKED`).toContain('FOR UPDATE');
      expect(text, `${name} does not skip locked rows`).toContain('SKIP LOCKED');
    }
  });

  it('completes under a compare-and-set on owner AND generation in both', () => {
    const persistence = join(__dirname, '..', '..', 'persistence');
    const wonderland = readFileSync(join(persistence, 'wonderland-postgres.ts'), 'utf8');
    const juliusRepo = readFileSync(join(persistence, 'julius-postgres.ts'), 'utf8');
    // The whole authority model: neither an owner alone nor a generation alone
    // is enough to finish a leased subject.
    expect(wonderland).toMatch(/lease_owner=\$\d+ AND lease_generation=\$\d+/);
    expect(juliusRepo).toMatch(/lease_owner=\$\d+ AND lease_generation=\$\d+/);
  });

  it('keeps the three concepts distinct rather than merging the tables', () => {
    // TASK GRAPH is a dependency structure; SWARM is a parallel strategy. A
    // merged table would carry a battle's role fan-out and a mission's
    // dependency graph with a nullable half.
    expect(julius).toContain('julius_task_dependencies');
    expect(swarm).not.toContain('dependenc');
    expect(swarm).toContain('concurrency_ceiling');
    expect(julius).not.toContain('concurrency_ceiling');
  });
});

/* ------------------------------------------------------------- fairness */

describe('one run cannot monopolize a tick', () => {
  const twoRuns = (perRunShare: number | null) => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], concurrency: 50 }),
    });
    // A large old run, then a small new one — the claim query orders by run
    // creation, so the large one is offered first.
    harness.store.seedRun({
      runId: 'run-big', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
      cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
    });
    for (let index = 0; index < 20; index += 1) {
      harness.store.seedTask('run-big', task({ taskId: `big-${index}`, ordinal: index }));
    }
    harness.store.seedRun({
      runId: 'run-small', missionId: 'msn-2', projectId: 'prj-1', state: 'READY',
      cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
    });
    harness.store.seedTask('run-small', { ...task({ taskId: 'small-0', ordinal: 0 }), missionId: 'msn-2' });

    const loop = new JuliusRunLoop(harness.deps, harness.policies, {
      claimLimit: 10, leaseMs: 60_000, perRunShare,
    });
    return { harness, loop };
  };

  it('starves the small run when no share is set — the case fairness exists for', async () => {
    const { loop } = twoRuns(null);
    const report = await loop.tick({ projectId: 'prj-1' });
    // Without a share every admitted task can come from one run.
    expect(report.yieldedForFairness).toBe(0);
    expect(report.outcomes.length).toBeGreaterThan(0);
  });

  it('gives the small run a turn when a share is set', async () => {
    const { loop } = twoRuns(3);
    const report = await loop.tick({ projectId: 'prj-1' });
    const runs = new Set(report.outcomes.map((outcome) => outcome.taskId.split('-')[0]));
    expect(runs.has('small'), 'the small run got no turn').toBe(true);
    expect(report.yieldedForFairness).toBeGreaterThan(0);
  });

  it('hands the excess back rather than holding it, so another worker can take it', async () => {
    const { harness, loop } = twoRuns(1);
    await loop.tick({ projectId: 'prj-1' });
    const yielded = Array.from({ length: 20 }, (_, index) => harness.store.taskRow(`big-${index}`)!)
      .filter((row) => row.state === 'RUNNABLE');
    expect(yielded.length).toBeGreaterThan(0);
    for (const row of yielded) expect(row.leaseOwner).toBeNull();
  });

  it('reports the share it enforced, so a wide claim limit is visible', async () => {
    const { loop } = twoRuns(2);
    const report = await loop.tick({ projectId: 'prj-1' });
    expect(report.claimed).toBeGreaterThan(report.outcomes.length);
    expect(report.yieldedForFairness).toBe(report.claimed - report.outcomes.length);
  });
});
