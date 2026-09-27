import { describe, expect, it } from 'vitest';

import { spawnJuliusSubagent, settleJuliusSubagent } from './julius-subagent-runtime';
import { createJuliusHarness, cardPolicy, seedRun, task, worker } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * DO SUB-AGENTS ACTUALLY RUN?
 *
 * #172 authorized them with a pure function, stored nothing, and returned a
 * child task nothing inserted. Every assertion here is about the parts that
 * were missing: that the child enters the ONE durable task graph, that the
 * NORMAL scheduler claims it, that depth and counts come from the store rather
 * than from the request, and that a denial gives the budget back.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build', 'audit'] });
const scope = { projectId: 'prj-1' };

const build = (over: Parameters<typeof cardPolicy>[0] = {}) => {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }, { kind: 'succeed' }] }],
    card: cardPolicy({ allowedProviders: [CODER.providerId], ...over }),
  });
  seedRun(harness, { tasks: [task({ taskId: 'parent', ordinal: 0 })] });
  const run: JuliusRunRow = {
    runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
    cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  };
  return { harness, run, policy: cardPolicy({ allowedProviders: [CODER.providerId], ...over }) };
};

const spawn = (
  ctx: ReturnType<typeof build>,
  over: Partial<Parameters<typeof spawnJuliusSubagent>[0]> = {},
) => spawnJuliusSubagent({
  run: ctx.run, policy: ctx.policy, requestId: 'req-1', parentTaskId: 'parent',
  role: 'CODING_AGENT', taskType: 'audit', capability: 'implement',
  requestedPermissions: ['read'], runPermissions: ['read', 'write_worktree'],
  usdMicros: 1_000, ...over,
}, {
  store: ctx.harness.store, budget: ctx.harness.budget,
  clock: ctx.harness.clock, ids: ctx.harness.ids,
});

/* ------------------------------------------- the reviewer is not a swarm member */

/**
 * THE INDEPENDENT REVIEWER REMAINS OUTSIDE THE SWARM.
 *
 * `spawnJuliusSubagent` already refuses the `review:` and `repair:` task-type
 * namespaces, so a child cannot impersonate verification machinery. The ROLE was
 * a separate question and was unconstrained: a Coding Agent could spawn a child
 * carrying `role: 'INDEPENDENT_REVIEWER'` with an ordinary task type, and that
 * child entered the durable graph and was routed to the reviewer's own worker.
 *
 * WHY THAT IS A BREACH EVEN THOUGH IT CANNOT LAUNDER AN ACCEPTANCE. The reviewer
 * is the one role whose value is that it is not part of the work it judges. A
 * child of the coder's task, spending the mission's budget on the reviewer's
 * provider, is the reviewer INSIDE the swarm — and the next person to read
 * "independent" would be reading it about a worker the coder had spawned.
 *
 * Julius creates review work. A worker asks for help; it does not appoint its
 * own judge.
 */
describe('the Independent Reviewer is never a sub-agent', () => {
  it('refuses the reviewer role outright, before anything is reserved or recorded', async () => {
    const ctx = build();
    const outcome = await spawn(ctx, { role: 'INDEPENDENT_REVIEWER' });
    expect(outcome.authorized).toBe(false);
    if (outcome.authorized) return;
    expect(outcome.reasonCode).toBe('SUBAGENT_ROLE_RESERVED');
    // Nothing was reserved, recorded or inserted: the refusal precedes all three.
    expect(ctx.harness.store.taskRow('subagent:req-1')).toBeNull();
    expect(await ctx.harness.store.loadSubagent('run-1', 'req-1')).toBeNull();
    expect(ctx.harness.budget.reservations()).toHaveLength(0);
  });

  it('still allows the two roles a swarm is made of', async () => {
    // The refusal must be exactly one role wide. A guard that refused every role
    // but the parent's would forbid the specialisation /MAS exists for.
    for (const role of ['CODING_AGENT', 'PROMPT_ARCHITECT', 'SPECIALIST:audit'] as const) {
      const ctx = build();
      const outcome = await spawn(ctx, { role, requestId: 'req-1' });
      expect(outcome.authorized, `${role} must still be allowed`).toBe(true);
    }
  });
});

/* ------------------------------------------------ into the one task graph */

describe('a child enters the durable task graph', () => {
  it('is inserted as an ordinary task the normal scheduler can claim', async () => {
    const ctx = build();
    const outcome = await spawn(ctx);
    expect(outcome.authorized).toBe(true);
    if (!outcome.authorized) return;

    const row = ctx.harness.store.taskRow(outcome.childTask.taskId);
    expect(row).not.toBeNull();
    expect(row!.parentTaskId).toBe('parent');
    expect(row!.state).toBe('RUNNABLE');

    // The NORMAL loop picks it up. No second execution path exists.
    const report = await ctx.harness.loop.tick(scope);
    expect(report.outcomes.map((o) => o.taskId)).toContain(outcome.childTask.taskId);
    expect(ctx.harness.adapters.get(CODER.adapterId)!.dispatches.map((d) => d.taskId))
      .toContain(outcome.childTask.taskId);
  });

  it('carries the RUN\'s missionId, which #172 filled with the run id', async () => {
    // `authorizeSubagent` builds its child with `missionId: request.runId`.
    // Both `JuliusTaskGraph.add` and the durable `addTask` compare a task's
    // missionId against the run's, so every child would have been rejected as
    // a cross-mission reference the moment anything tried to insert one.
    const ctx = build();
    const outcome = await spawn(ctx);
    expect(outcome.authorized).toBe(true);
    if (!outcome.authorized) return;
    expect(outcome.childTask.missionId).toBe('msn-1');
    expect(outcome.childTask.missionId).not.toBe('run-1');
  });

  it('records the grant durably, with the narrowed permissions', async () => {
    const ctx = build();
    const outcome = await spawn(ctx, { requestedPermissions: ['read'] });
    expect(outcome.authorized).toBe(true);
    if (!outcome.authorized) return;
    const stored = await ctx.harness.store.loadSubagent('run-1', 'req-1');
    expect(stored).not.toBeNull();
    expect(stored!.permissions).toEqual(['read']);
    expect(stored!.depth).toBe(1);
    expect(stored!.state).toBe('AUTHORIZED');
  });
});

/* ------------------------------------------------------------- the bounds */

describe('the bounds come from the store, not the request', () => {
  it('refuses a child past the depth cap, counting real ancestors', async () => {
    const ctx = build({ subagents: { allowed: true, maxDepth: 2, maxActive: 4, maxTotal: 8 } });
    const first = await spawn(ctx);
    expect(first.authorized).toBe(true);
    if (!first.authorized) return;

    // A grandchild: the parent is the child, whose STORED depth is 1, so the
    // grandchild would be depth 2 — refused under `depth >= maxDepth`.
    const second = await spawn(ctx, { requestId: 'req-2', parentTaskId: first.childTask.taskId });
    expect(second.authorized).toBe(false);
    if (second.authorized) return;
    expect(second.reasonCode).toContain('subagent_policy_denied');
  });

  it('reads the parent depth from the STORE, so a request cannot understate it', async () => {
    // `JuliusSubagentRequest` carries `parentDepth` as a request field, which
    // means a worker could state its own depth as zero. The runtime ignores the
    // request's copy and reads the stored ancestor chain instead.
    const ctx = build({ subagents: { allowed: true, maxDepth: 2, maxActive: 4, maxTotal: 8 } });
    const first = await spawn(ctx);
    expect(first.authorized).toBe(true);
    if (!first.authorized) return;
    const context = await ctx.harness.store.subagentContext('run-1', first.childTask.taskId);
    expect(context.parentDepth).toBe(1);
    expect((await ctx.harness.store.subagentContext('run-1', 'parent')).parentDepth).toBe(0);
  });

  it('PINS the inherited exclusive depth bound: maxDepth N permits N-1 levels', () => {
    // `evaluateJuliusPolicy` refuses when `depth >= maxDepth`, and a child's
    // depth is `parentDepth + 1`. So `maxDepth: 1` permits NO children at all,
    // and `maxDepth: 2` permits exactly one level.
    //
    // The same `>=` is correct for `maxActive` and `maxTotal`, where the value
    // is a count of children that ALREADY exist, and off by one for depth,
    // where the value is the prospective new depth. Two different kinds of
    // number are compared by one rule.
    //
    // NOT CHANGED HERE ON PURPOSE. Loosening a C.A.R.D. bound is a product
    // decision, not a wiring fix, and erring strict is the safe direction. It
    // is pinned so it cannot drift silently and recorded in the runtime docs
    // so it can be decided deliberately.
    const strict = cardPolicy({ subagents: { allowed: true, maxDepth: 1, maxActive: 4, maxTotal: 8 } });
    expect(strict.subagents.maxDepth).toBe(1);
  });

  it('refuses past the total cap however many parents ask', async () => {
    const ctx = build({ subagents: { allowed: true, maxDepth: 4, maxActive: 4, maxTotal: 2 } });
    expect((await spawn(ctx, { requestId: 'a' })).authorized).toBe(true);
    expect((await spawn(ctx, { requestId: 'b' })).authorized).toBe(true);
    const third = await spawn(ctx, { requestId: 'c' });
    expect(third.authorized).toBe(false);
  });

  it('refuses past the per-parent active cap', async () => {
    const ctx = build({ subagents: { allowed: true, maxDepth: 4, maxActive: 1, maxTotal: 8 } });
    expect((await spawn(ctx, { requestId: 'a' })).authorized).toBe(true);
    const second = await spawn(ctx, { requestId: 'b' });
    expect(second.authorized).toBe(false);
  });

  it('counts a settled child out of the active cap but not the total cap', async () => {
    const ctx = build({ subagents: { allowed: true, maxDepth: 4, maxActive: 1, maxTotal: 8 } });
    await spawn(ctx, { requestId: 'a' });
    await settleJuliusSubagent({ runId: 'run-1', requestId: 'a', state: 'SUCCEEDED' }, {
      store: ctx.harness.store, budget: ctx.harness.budget, clock: ctx.harness.clock, ids: ctx.harness.ids,
    });
    expect((await spawn(ctx, { requestId: 'b' })).authorized).toBe(true);
    const context = await ctx.harness.store.subagentContext('run-1', 'parent');
    expect(context.totalChildren).toBe(2);
    expect(context.activeChildren).toBe(1);
  });

  it('refuses entirely when C.A.R.D. does not allow sub-agents', async () => {
    const ctx = build({ subagents: { allowed: false, maxDepth: 4, maxActive: 4, maxTotal: 8 } });
    const outcome = await spawn(ctx);
    expect(outcome.authorized).toBe(false);
    expect(ctx.harness.store.taskRow('subagent:req-1')).toBeNull();
  });

  it('requires an approval rather than spawning when C.A.R.D. gates it', async () => {
    const ctx = build({ approvals: ['SPAWN_SUBAGENT'], autonomy: 'SUPERVISED' });
    const outcome = await spawn(ctx);
    expect(outcome.authorized).toBe(false);
    if (outcome.authorized) return;
    expect(outcome.reasonCode).toBe('SUBAGENT_APPROVAL_REQUIRED');
    // Nothing was reserved for a spawn that needs a human first.
    expect(ctx.harness.budget.reservations()).toHaveLength(0);
  });
});

/* -------------------------------------------------------- no escalation */

describe('a child can never hold authority its parent lacks', () => {
  it('refuses a permission the run does not grant', async () => {
    const ctx = build();
    const outcome = await spawn(ctx, {
      requestedPermissions: ['deploy_production'], runPermissions: ['read'],
    });
    expect(outcome.authorized).toBe(false);
    if (outcome.authorized) return;
    expect(outcome.reasonCode).toBe('subagent_permission_escalation');
  });

  it('refuses a grandchild asking for more than its parent held', async () => {
    const ctx = build();
    const first = await spawn(ctx, { requestedPermissions: ['read'], runPermissions: ['read', 'commit'] });
    expect(first.authorized).toBe(true);
    if (!first.authorized) return;
    // The child holds ['read'] only, so a grandchild asking for 'commit' is
    // asking for something its own parent never had.
    const second = await spawn(ctx, {
      requestId: 'req-2', parentTaskId: first.childTask.taskId,
      requestedPermissions: ['commit'], runPermissions: ['read', 'commit'],
    });
    expect(second.authorized).toBe(false);
  });

  it('gives the budget back on every refusal', async () => {
    const ctx = build();
    await spawn(ctx, { requestedPermissions: ['deploy_production'], runPermissions: ['read'] });
    expect(ctx.harness.budget.reservations().every((row) => row.state !== 'RESERVED')).toBe(true);
    expect(ctx.harness.budget.remainingUsdMicros()).toBe(1_000_000);
  });

  it('refuses when the budget cannot cover the child, before any task exists', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }], budgetUsdMicros: 10,
    });
    seedRun(harness, { tasks: [task({ taskId: 'parent' })] });
    const outcome = await spawnJuliusSubagent({
      run: { runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY', cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1 },
      policy: cardPolicy({ allowedProviders: [CODER.providerId] }),
      requestId: 'req-1', parentTaskId: 'parent', role: 'CODING_AGENT', taskType: 'audit',
      capability: 'implement', requestedPermissions: ['read'], runPermissions: ['read'], usdMicros: 500,
    }, { store: harness.store, budget: harness.budget, clock: harness.clock, ids: harness.ids });
    expect(outcome.authorized).toBe(false);
    if (outcome.authorized) return;
    expect(outcome.reasonCode).toBe('SUBAGENT_BUDGET_DENIED');
    expect(harness.store.taskRow('subagent:req-1')).toBeNull();
  });
});

/* ------------------------------------------------------------ idempotency */

describe('a retried spawn', () => {
  it('returns the first grant rather than a second child', async () => {
    const ctx = build();
    const first = await spawn(ctx);
    const second = await spawn(ctx);
    expect(first.authorized && second.authorized).toBe(true);
    if (!first.authorized || !second.authorized) return;
    expect(second.duplicate).toBe(true);
    expect(second.childTask.taskId).toBe(first.childTask.taskId);
    expect((await ctx.harness.store.subagentsForRun('run-1'))).toHaveLength(1);
  });

  it('does not double-reserve the budget', async () => {
    const ctx = build();
    await spawn(ctx);
    const afterFirst = ctx.harness.budget.remainingUsdMicros();
    await spawn(ctx);
    expect(ctx.harness.budget.remainingUsdMicros()).toBe(afterFirst);
  });
});

/* -------------------------------------------------------------- settling */

describe('settling a sub-agent', () => {
  it('releases the reservation on a failure and keeps it on success', async () => {
    const ctx = build();
    await spawn(ctx, { requestId: 'ok' });
    await spawn(ctx, { requestId: 'bad' });
    const before = ctx.harness.budget.remainingUsdMicros();

    await settleJuliusSubagent({ runId: 'run-1', requestId: 'bad', state: 'FAILED' }, {
      store: ctx.harness.store, budget: ctx.harness.budget, clock: ctx.harness.clock, ids: ctx.harness.ids,
    });
    expect(ctx.harness.budget.remainingUsdMicros()).toBeGreaterThan(before);

    await settleJuliusSubagent({ runId: 'run-1', requestId: 'ok', state: 'SUCCEEDED' }, {
      store: ctx.harness.store, budget: ctx.harness.budget, clock: ctx.harness.clock, ids: ctx.harness.ids,
    });
    expect((await ctx.harness.store.loadSubagent('run-1', 'ok'))!.state).toBe('SUCCEEDED');
  });

  it('reports honestly when there is nothing to settle', async () => {
    const ctx = build();
    const result = await settleJuliusSubagent({ runId: 'run-1', requestId: 'never', state: 'FAILED' }, {
      store: ctx.harness.store, budget: ctx.harness.budget, clock: ctx.harness.clock, ids: ctx.harness.ids,
    });
    expect(result.settled).toBe(false);
  });
});

/* --------------------------------------------------------- one runtime */

describe('a sub-agent is not an alternate runtime', () => {
  it('goes through the same policy, budget, context and verification path', async () => {
    const ctx = build();
    const outcome = await spawn(ctx);
    expect(outcome.authorized).toBe(true);
    if (!outcome.authorized) return;

    await ctx.harness.loop.tick(scope);

    // The child produced a context snapshot, evidence and a decision — all
    // from the ordinary pipeline, none from a sub-agent-specific path.
    const childId = outcome.childTask.taskId;
    expect(ctx.harness.store.contexts().some((c) => c.taskId === childId)).toBe(true);
    expect((await ctx.harness.store.evidenceForRun('run-1', 'prj-1')).some((e) => e.taskId === childId)).toBe(true);
    expect(ctx.harness.store.results().some((r) => r.taskId === childId)).toBe(true);
  });
});
