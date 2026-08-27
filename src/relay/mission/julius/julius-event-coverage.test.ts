import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { JULIUS_OPERATIONAL_EVENT_TYPES, validateJuliusEvent } from './julius-events';
import { JuliusRunLoop } from './julius-run-loop';
import { requestJuliusApproval, decideJuliusApproval, cancelJuliusRun } from './julius-lifecycle-runtime';
import { spawnJuliusSubagent, settleJuliusSubagent } from './julius-subagent-runtime';
import { advanceJuliusGauntletRound, startJuliusGauntlet } from './julius-gauntlet-runtime';
import { cardPolicy, createJuliusHarness, seedRun, task, worker, verificationPolicy } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';
import type { JuliusTask } from './julius-runtime';

/**
 * THE CATALOGUE AND THE EMISSIONS MUST AGREE, IN BOTH DIRECTIONS.
 *
 * A type DECLARED and never emitted is a promise nothing keeps: a consumer
 * subscribes, waits, and concludes the thing never happens. A type EMITTED and
 * never declared is an event no consumer can name, and one already existed —
 * the execution coordinator emitted `task.failed` while the authoritative list
 * did not contain it.
 *
 * The audit is STATIC: it reads the runtime source, collects every literal any
 * `ledger.event(...)` or `type: '...'` actually passes, and compares the two
 * sets. A dynamic test could only prove what its own scenarios happen to
 * reach, which is exactly the gap that let four types sit unemitted.
 */

/**
 * THE SOURCES THAT MAY EMIT.
 *
 * Both halves of Julius core: the runtime modules here, and the PostgreSQL
 * repositories, which write `run.created`, `run.transitioned`, `task.created`
 * and `evidence.recorded` inside the same transaction as the state change they
 * describe. The first version of this scanner read only this directory and
 * reported four types as unemitted that are emitted one layer down — a
 * scanner whose SCOPE is wrong produces exactly the same red as a real gap,
 * and telling them apart is the only thing that made the other four findings
 * believable.
 */
const RUNTIME_DIRECTORY = __dirname;
const PERSISTENCE_DIRECTORY = join(__dirname, '..', '..', 'persistence');

const sources = [
  ...readdirSync(RUNTIME_DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('fixtures'))
    .map((name) => ({ name, text: readFileSync(join(RUNTIME_DIRECTORY, name), 'utf8') })),
  ...readdirSync(PERSISTENCE_DIRECTORY)
    .filter((name) => name.startsWith('julius') && name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(PERSISTENCE_DIRECTORY, name), 'utf8') })),
];

/**
 * Every event type any Julius source NAMES.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT, stated because the difference
 * matters. It proves that no type is DECLARED and mentioned nowhere — the
 * "promise nothing keeps" case, which is what four types were. It does NOT
 * prove a mentioned type is actually reached: a name in a comment counts, and
 * so does a name in a map that nothing indexes.
 *
 * Proving actual emission is the runtime section below, which drives the real
 * runtime and reads the ledger back for every family. Two partial guarantees,
 * each labelled, is what is honestly available: a scanner that tried to follow
 * every JavaScript shape an event type can travel through — a ternary, an
 * object literal keyed by state, a second argument to a private method — would
 * be a parser, and a wrong parser reports noise as a finding. The first
 * version of this one did exactly that, twice.
 */
const DOTTED = /'([a-z]+(?:\.[a-z]+)+)'/g;

function namedTypes(): Set<string> {
  const found = new Set<string>();
  for (const source of sources) {
    // The catalogue declares every type and emits none of them.
    if (source.name === 'julius-events.ts') continue;
    for (const match of source.text.matchAll(DOTTED)) {
      found.add(match[1]!.replace(/^julius\./, ''));
    }
  }
  return found;
}

/* ---------------------------------------------------- the real emissions */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build', 'audit', 'repair:build'] });
const REVIEWER = worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', capabilities: ['review'], taskTypes: ['review:build'] });
const OTHER = worker({ workerId: 'coder-b', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], providerId: 'provider-b', adapterId: 'coder-b-adapter' });

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};

describe('no event type is declared and named nowhere', () => {
  const named = namedTypes();

  it('found names at all — a silent zero would pass every check below', () => {
    expect(named.size).toBeGreaterThan(20);
  });

  for (const type of JULIUS_OPERATIONAL_EVENT_TYPES) {
    it(`${type} is named by a runtime source`, () => {
      expect(named.has(type), `${type} is declared and no source mentions it`).toBe(true);
    });
  }
});

describe('every event the runtime actually writes is declared', () => {
  it('names no type the catalogue does not carry', async () => {
    // Asserted against the LEDGER rather than the source: what a source
    // mentions is a weaker fact than what a run actually wrote, and the
    // undeclared-type case is the one where the weaker fact is not enough.
    // This is the direction that already caught `task.failed` on merged main.
    const declared = new Set<string>(JULIUS_OPERATIONAL_EVENT_TYPES);
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    const written = [...new Set(harness.store.events().map((event) => event.type))];
    expect(written.length).toBeGreaterThan(5);
    const undeclared = written.filter((type) => !declared.has(type));
    expect(undeclared, `written and undeclared: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('declares each type exactly once', () => {
    expect(new Set(JULIUS_OPERATIONAL_EVENT_TYPES).size).toBe(JULIUS_OPERATIONAL_EVENT_TYPES.length);
  });

  it('carries no display wording — a type is a machine name', () => {
    for (const type of JULIUS_OPERATIONAL_EVENT_TYPES) {
      expect(type, `${type} is not a stable dotted machine name`).toMatch(/^[a-z]+(?:\.[a-z]+)+$/);
      expect(type).not.toMatch(/ /);
    }
  });
});

describe('the runtime really emits them', () => {
  it('emits the dispatch family on an ordinary task', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    const types = new Set(harness.store.events().map((event) => event.type));
    for (const expected of ['task.claimed', 'context.compiled', 'worker.selected', 'budget.reserved',
      'worker.dispatched', 'worker.completed', 'budget.settled', 'verification.decided'] as const) {
      expect(types.has(expected), expected).toBe(true);
    }
  });

  it('emits task.runnable when a dependency is satisfied', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }] }] });
    seedRun(harness, {
      tasks: [task({ taskId: 'first', ordinal: 0 }), task({ taskId: 'second', ordinal: 1, state: 'BLOCKED', dependencyIds: ['first'] })],
    });
    await harness.loop.tick(scope);
    const runnable = harness.store.events().find((event) => event.type === 'task.runnable');
    expect(runnable).toBeDefined();
    expect(runnable!.taskId).toBe('second');
    expect(runnable!.facts.unblockedBy).toBe('first');
  });

  it('emits provider.failure, reroute.selected and fallback.selected on a reroute', async () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: CODER, script: [{ kind: 'fail', code: 'PROVIDER_UNAVAILABLE' }] },
        { worker: OTHER, script: [{ kind: 'succeed' }] },
      ],
      card: cardPolicy({ allowedProviders: [CODER.providerId, OTHER.providerId], autonomy: 'AUTONOMOUS' }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    const types = new Set(harness.store.events().map((event) => event.type));
    expect(types.has('provider.failure')).toBe(true);
    expect(types.has('reroute.selected')).toBe(true);
    expect(types.has('fallback.selected')).toBe(true);
    // And the reroute actually reached the other worker.
    expect(harness.adapters.get(OTHER.adapterId)!.dispatches.length).toBeGreaterThan(0);
  });

  it('emits review.started and repair.scheduled', async () => {
    const reviewHarness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }, { worker: REVIEWER, script: [{ kind: 'succeed' }] }],
      verification: verificationPolicy({ reviewerRequired: true }),
    });
    seedRun(reviewHarness, { tasks: [task({ taskId: 'task-1' })] });
    await reviewHarness.loop.tick(scope);
    expect(reviewHarness.store.events().map((e) => e.type)).toContain('review.started');

    const repairHarness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(repairHarness, { tasks: [task({ taskId: 'task-1' })] });
    repairHarness.store.seedFinding({
      findingId: 'f-1', runId: 'run-1', taskId: 'task-1', reviewerWorkerId: 'reviewer',
      severity: 'HIGH', category: 'correctness', claim: 'blocking', criterionId: null,
      evidenceIds: ['task-1:1:0'], blocking: true, status: 'OPEN', createdAt: '2026-08-27T00:00:00.000Z',
    });
    await repairHarness.loop.tick(scope);
    expect(repairHarness.store.events().map((e) => e.type)).toContain('repair.scheduled');
  });

  it('emits the sub-agent family', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'parent' })] });
    const deps = {
      store: harness.store, budget: harness.budget, clock: harness.clock,
      ids: harness.ids, events: harness.store,
    };
    const request = {
      run: RUN, policy: cardPolicy({ allowedProviders: [CODER.providerId] }), requestId: 'req-1',
      parentTaskId: 'parent', role: 'CODING_AGENT' as const, taskType: 'audit', capability: 'implement',
      requestedPermissions: ['read'], runPermissions: ['read'], usdMicros: 100,
    };
    await spawnJuliusSubagent(request, deps);
    await settleJuliusSubagent({ runId: 'run-1', requestId: 'req-1', state: 'SUCCEEDED' }, deps);
    await spawnJuliusSubagent({
      ...request, requestId: 'req-2', requestedPermissions: ['deploy_production'],
    }, deps);

    const types = new Set(harness.store.events().map((event) => event.type));
    expect(types.has('subagent.spawned')).toBe(true);
    expect(types.has('subagent.completed')).toBe(true);
    expect(types.has('subagent.denied')).toBe(true);
  });

  it('emits the gauntlet family', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'anchor' })] });
    const deps = { store: harness.store, clock: harness.clock, ids: harness.ids, events: harness.store };
    const policy = cardPolicy({ allowedProviders: [CODER.providerId] });
    const anchor = task({ taskId: 'anchor' }) as JuliusTask;
    await startJuliusGauntlet({
      run: RUN, policy, gauntletId: 'g-1', anchor,
      limits: { maxRounds: 2, maxRetries: 0, maxDurationMs: 60_000, maxUsdMicros: 10_000 },
    }, deps);
    await advanceJuliusGauntletRound({
      run: RUN, policy, anchor, gauntletId: 'g-1', phase: 'EXECUTE', outcome: 'PASSED',
      durationMs: 10, usdMicros: 10, evidenceIds: [], reviewerRequired: false,
    }, deps);

    const types = new Set(harness.store.events().map((event) => event.type));
    expect(types.has('gauntlet.started')).toBe(true);
    expect(types.has('gauntlet.round.started')).toBe(true);
    expect(types.has('gauntlet.round.completed')).toBe(true);
    expect(types.has('gauntlet.cleared')).toBe(true);

    // And a halt, on a second gauntlet that runs out of retries.
    const halting = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(halting, { tasks: [task({ taskId: 'anchor' })] });
    const haltDeps = { store: halting.store, clock: halting.clock, ids: halting.ids, events: halting.store };
    await startJuliusGauntlet({
      run: RUN, policy, gauntletId: 'g-2', anchor,
      limits: { maxRounds: 2, maxRetries: 0, maxDurationMs: 60_000, maxUsdMicros: 10_000 },
    }, haltDeps);
    await advanceJuliusGauntletRound({
      run: RUN, policy, anchor, gauntletId: 'g-2', phase: 'EXECUTE', outcome: 'FAILED',
      durationMs: 10, usdMicros: 10, evidenceIds: [], reviewerRequired: false,
    }, haltDeps);
    expect(halting.store.events().map((e) => e.type)).toContain('gauntlet.halted');
  });

  it('emits the approval family and task.cancelled', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const deps = { store: harness.store, clock: harness.clock, ids: harness.ids, events: harness.store };
    await requestJuliusApproval({
      run: RUN, approvalId: 'apr-1', taskId: 'task-1', operation: 'MUTATE_FILESYSTEM',
      policyRevision: 'card-r1', reasonCode: 'CARD_APPROVAL_REQUIRED',
      safeRationale: 'gate', idempotencyKey: 'gate-1',
    }, deps);
    await decideJuliusApproval({
      runId: 'run-1', projectId: 'prj-1', approvalId: 'apr-1',
      decision: 'APPROVED', approverId: 'ghu-1', reason: 'Reviewed.',
    }, { ...deps, approvers: { async mayApprove() { return true; } } });
    await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'Superseded.' }, deps);

    const types = new Set(harness.store.events().map((event) => event.type));
    expect(types.has('approval.requested')).toBe(true);
    expect(types.has('approval.decided')).toBe(true);
    expect(types.has('task.cancelled')).toBe(true);
  });

  it('emits recovery.action for a reclaimed lease, and never for another tenant', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.store.claimRunnable({
      owner: 'ghost', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T00:00:01.000Z', limit: 1, projectId: 'prj-1',
    });
    harness.clock.advance(60_000);

    const report = await harness.loop.recover(scope, harness.store);
    expect(report.actions).toBe(1);
    expect(report.requeued).toBe(1);
    expect(harness.store.events().map((e) => e.type)).toContain('recovery.action');

    // A sweep scoped to another project touches nothing and writes nothing.
    const before = harness.store.events().length;
    const other = await harness.loop.recover({ projectId: 'prj-intruder' }, harness.store);
    expect(other.actions).toBe(0);
    expect(harness.store.events()).toHaveLength(before);
  });

  it('validates every event it emits, so no credential-shaped fact can land', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    for (const event of harness.store.events()) {
      expect(() => validateJuliusEvent(event)).not.toThrow();
      expect(JULIUS_OPERATIONAL_EVENT_TYPES as readonly string[]).toContain(event.type);
    }
  });
});

/* -------------------------------------------------------- the known gap */

describe('the type deliberately absent from the catalogue', () => {
  it('does not declare autonomy.changed, because nothing can emit it', () => {
    // C.A.R.D. policy is not persisted — `julius_runs` stores a
    // `card_revision` and nothing stores the policy it names — so a run's
    // autonomy cannot be changed at runtime. A type for an event nothing emits
    // is a promise nothing keeps, which is what the audit above refuses.
    expect(JULIUS_OPERATIONAL_EVENT_TYPES as readonly string[]).not.toContain('autonomy.changed');
  });
});

/* --------------------------------------------------------- the loop shape */

describe('the recovery sweep is separate from the tick', () => {
  it('is its own bounded call, so a deployment sets its cadence', () => {
    const names = Object.getOwnPropertyNames(JuliusRunLoop.prototype);
    expect(names).toContain('tick');
    expect(names).toContain('recover');
  });
});
