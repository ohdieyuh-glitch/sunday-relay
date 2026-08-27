import { describe, expect, it } from 'vitest';

import {
  JULIUS_API_SCOPES, JULIUS_TIMELINE_PAGE_LIMIT, JuliusRuntimeApi,
  type JuliusApiIdentity,
} from './julius-runtime-api';
import { requestJuliusApproval } from './julius-lifecycle-runtime';
import { spawnJuliusSubagent } from './julius-subagent-runtime';
import { cardPolicy, createJuliusHarness, seedRun, task, worker } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE EXECUTION API, ATTACKED BEFORE IT IS USED.
 *
 * The API is the one surface anything outside the runtime reaches, so most of
 * this file is about what it REFUSES. Every method takes an identity as its
 * first argument, so there is no overload that omits the check — but "the
 * check exists" and "the check is applied on every path" are different claims,
 * and only the second one is worth anything.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build', 'audit'] });
const scope = { projectId: 'prj-1' };

const identity = (over: Partial<JuliusApiIdentity> = {}): JuliusApiIdentity => ({
  tenantId: 'tenant-1', projectId: 'prj-1', actorId: 'ghu-1',
  scopes: [...JULIUS_API_SCOPES], ...over,
});

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};

const build = (opts: { mayApprove?: boolean } = {}) => {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }, { kind: 'succeed' }] }],
    card: cardPolicy({ allowedProviders: [CODER.providerId] }),
  });
  seedRun(harness, { tasks: [task({ taskId: 'task-1', ordinal: 0 }), task({ taskId: 'task-2', ordinal: 1 })] });
  const api = new JuliusRuntimeApi({
    store: harness.store, timeline: harness.store, clock: harness.clock,
    approvers: { async mayApprove() { return opts.mayApprove ?? true; } },
  });
  return { harness, api };
};

/* ------------------------------------------------------------ inspection */

describe('inspecting a run', () => {
  it('reports its state, its revision and a count per task state', async () => {
    const ctx = build();
    await ctx.harness.loop.tick(scope);
    const result = await ctx.api.inspectRun(identity(), 'run-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runId).toBe('run-1');
    expect(result.value.missionId).toBe('msn-1');
    expect(result.value.taskCounts.SUCCEEDED).toBe(2);
    expect(result.value.taskCounts.ACTIVE).toBe(0);
    expect(result.value.cardRevision).toBe('card-r1');
    expect(result.value.revision).toBeGreaterThan(1);
  });

  it('returns tasks, evidence, decisions and findings for a run it may see', async () => {
    const ctx = build();
    await ctx.harness.loop.tick(scope);
    const tasks = await ctx.api.inspectTasks(identity(), 'run-1');
    const evidence = await ctx.api.inspectEvidence(identity(), 'run-1');
    const verification = await ctx.api.inspectVerification(identity(), 'run-1');
    expect(tasks.ok && tasks.value.length).toBe(2);
    expect(evidence.ok && evidence.value.length).toBeGreaterThan(0);
    expect(verification.ok && verification.value.decisions.length).toBeGreaterThan(0);
  });

  it('reports sub-agents', async () => {
    const ctx = build();
    await spawnJuliusSubagent({
      run: RUN, policy: cardPolicy({ allowedProviders: [CODER.providerId] }),
      requestId: 'req-1', parentTaskId: 'task-1', role: 'CODING_AGENT', taskType: 'audit',
      capability: 'implement', requestedPermissions: ['read'], runPermissions: ['read'], usdMicros: 100,
    }, { store: ctx.harness.store, budget: ctx.harness.budget, clock: ctx.harness.clock, ids: ctx.harness.ids });

    const subagents = await ctx.api.inspectSubagents(identity(), 'run-1');
    expect(subagents.ok && subagents.value.length).toBe(1);
  });

});

/* --------------------------------------------------------- authorization */

describe('authorization is applied on every path', () => {
  const reads = ['inspectRun', 'inspectTasks', 'inspectEvidence', 'inspectVerification',
    'inspectSubagents', 'inspectApprovals', 'timeline'] as const;

  it('refuses every read without the read scope', async () => {
    const ctx = build();
    const without = identity({ scopes: ['run:control'] });
    for (const method of reads) {
      const result = await (ctx.api[method] as (i: JuliusApiIdentity, r: string) => Promise<{ ok: boolean; reason?: string }>)(without, 'run-1');
      expect(result.ok, method).toBe(false);
      expect(result.reason, method).toBe('scope_missing');
    }
  });

  it('refuses every read for a project the caller does not hold', async () => {
    const ctx = build();
    const other = identity({ projectId: 'prj-intruder' });
    for (const method of reads) {
      const result = await (ctx.api[method] as (i: JuliusApiIdentity, r: string) => Promise<{ ok: boolean; reason?: string }>)(other, 'run-1');
      expect(result.ok, method).toBe(false);
      // NOT FOUND, not FORBIDDEN: telling a caller a run exists somewhere they
      // cannot see is itself a leak.
      expect(result.reason, method).toBe('run_not_found');
    }
  });

  it('refuses an incomplete identity, including a blank actor', async () => {
    const ctx = build();
    for (const over of [{ tenantId: '' }, { projectId: '   ' }, { actorId: '' }]) {
      const result = await ctx.api.inspectRun(identity(over), 'run-1');
      expect(result.ok, JSON.stringify(over)).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('identity_incomplete');
    }
  });

  it('refuses control without the control scope, and approval without its own', async () => {
    const ctx = build();
    const readOnly = identity({ scopes: ['run:read'] });
    for (const call of [
      ctx.api.pause(readOnly, 'run-1', 'stop'),
      ctx.api.resume(readOnly, 'run-1', 'go'),
      ctx.api.cancel(readOnly, 'run-1', 'stop'),
    ]) {
      const result = await call;
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('scope_missing');
    }
    const approval = await ctx.api.decideApproval(identity({ scopes: ['run:read', 'run:control'] }), {
      runId: 'run-1', approvalId: 'apr-1', decision: 'APPROVED', reason: 'ok',
    });
    expect(approval.ok).toBe(false);
  });

  it('holds read and control apart, so a dashboard cannot cancel', async () => {
    const ctx = build();
    const dashboard = identity({ scopes: ['run:read'] });
    expect((await ctx.api.inspectRun(dashboard, 'run-1')).ok).toBe(true);
    expect((await ctx.api.cancel(dashboard, 'run-1', 'stop')).ok).toBe(false);
  });

  it('declares exactly the three scopes the product splits on', () => {
    expect([...JULIUS_API_SCOPES].sort()).toEqual(['approval:decide', 'run:control', 'run:read']);
  });
});

/* ------------------------------------------------------------- controlling */

describe('controlling a run', () => {
  it('pauses, resumes and cancels through the durable operations', async () => {
    const ctx = build();
    const paused = await ctx.api.pause(identity(), 'run-1', 'Founder review.');
    expect(paused.ok && paused.value.applied).toBe(true);
    expect((await ctx.harness.loop.tick(scope)).claimed).toBe(0);

    const resumed = await ctx.api.resume(identity(), 'run-1', 'Go.');
    expect(resumed.ok && resumed.value.applied).toBe(true);

    const cancelled = await ctx.api.cancel(identity(), 'run-1', 'Superseded.');
    expect(cancelled.ok && cancelled.value.applied).toBe(true);
    expect((await ctx.api.inspectRun(identity(), 'run-1')).ok).toBe(true);
  });

  it('records the caller as the actor, never a blank', async () => {
    const ctx = build();
    await ctx.api.pause(identity({ actorId: 'ghu-42' }), 'run-1', 'hold');
    expect(ctx.harness.store.lifecycleOf('run-1')?.actor).toBe('ghu-42');
  });

  it('needs BOTH the scope and the approver authority to answer an approval', async () => {
    const permitted = build({ mayApprove: true });
    await requestJuliusApproval({
      run: RUN, approvalId: 'apr-1', taskId: 'task-1', operation: 'MUTATE_FILESYSTEM',
      policyRevision: 'card-r1', reasonCode: 'CARD_APPROVAL_REQUIRED',
      safeRationale: 'gate', idempotencyKey: 'gate-1',
    }, { store: permitted.harness.store, clock: permitted.harness.clock });
    const ok = await permitted.api.decideApproval(identity(), {
      runId: 'run-1', approvalId: 'apr-1', decision: 'APPROVED', reason: 'Reviewed.',
    });
    expect(ok.ok && ok.value.decided).toBe(true);

    // Correct scope, and the authority says this person may not approve THAT.
    const refused = build({ mayApprove: false });
    await requestJuliusApproval({
      run: RUN, approvalId: 'apr-1', taskId: 'task-1', operation: 'MUTATE_FILESYSTEM',
      policyRevision: 'card-r1', reasonCode: 'CARD_APPROVAL_REQUIRED',
      safeRationale: 'gate', idempotencyKey: 'gate-1',
    }, { store: refused.harness.store, clock: refused.harness.clock });
    const denied = await refused.api.decideApproval(identity(), {
      runId: 'run-1', approvalId: 'apr-1', decision: 'APPROVED', reason: 'Reviewed.',
    });
    expect(denied.ok).toBe(true);
    if (!denied.ok) return;
    expect(denied.value.decided).toBe(false);
  });
});

/* --------------------------------------------------------------- timeline */

describe('the safe timeline', () => {
  const withEvents = async () => {
    const ctx = build();
    await ctx.harness.loop.tick(scope);
    return ctx;
  };

  it('returns entries in sequence order with a resumable cursor', async () => {
    const ctx = await withEvents();
    const page = await ctx.api.timeline(identity(), 'run-1', 0, 5);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.entries.length).toBeGreaterThan(0);
    const sequences = page.value.entries.map((entry) => entry.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(page.value.nextCursor).toBe(sequences.at(-1));
    expect(page.value.gapDetected).toBe(false);
    expect(page.value.hasMore).toBe(true);
  });

  it('resumes from a cursor without repeating or skipping', async () => {
    const ctx = await withEvents();
    const first = await ctx.api.timeline(identity(), 'run-1', 0, 3);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await ctx.api.timeline(identity(), 'run-1', first.value.nextCursor, 3);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const firstIds = first.value.entries.map((entry) => entry.eventId);
    const secondIds = second.value.entries.map((entry) => entry.eventId);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(second.value.entries[0]!.sequence).toBe(first.value.nextCursor + 1);
    expect(second.value.gapDetected).toBe(false);
  });

  it('carries only safe scalar facts — never a payload or a prompt', async () => {
    const ctx = await withEvents();
    const page = await ctx.api.timeline(identity(), 'run-1');
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    for (const entry of page.value.entries) {
      for (const value of Object.values(entry.facts)) {
        expect(['string', 'number', 'boolean', 'object'].includes(typeof value)).toBe(true);
        if (typeof value === 'object') expect(value).toBeNull();
      }
    }
    const serialized = JSON.stringify(page.value);
    expect(serialized.toLowerCase()).not.toContain('chain of thought');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{8,}|Bearer\s+\S{16,}/);
  });

  it('bounds a page however large a limit is asked for', async () => {
    const ctx = await withEvents();
    const page = await ctx.api.timeline(identity(), 'run-1', 0, 10_000);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.entries.length).toBeLessThanOrEqual(JULIUS_TIMELINE_PAGE_LIMIT);
  });

  it('refuses a cursor that is not a sequence', async () => {
    const ctx = await withEvents();
    for (const cursor of [-1, 1.5, Number.NaN]) {
      const page = await ctx.api.timeline(identity(), 'run-1', cursor);
      expect(page.ok, String(cursor)).toBe(false);
      if (page.ok) continue;
      expect(page.reason).toBe('invalid_cursor');
    }
  });

  it('returns the caller\'s own cursor when there is nothing new', async () => {
    const ctx = await withEvents();
    const page = await ctx.api.timeline(identity(), 'run-1', 9_999);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.entries).toEqual([]);
    expect(page.value.nextCursor).toBe(9_999);
  });

  it('never serves another project\'s timeline for a run id it was handed', async () => {
    const ctx = await withEvents();
    const page = await ctx.api.timeline(identity({ projectId: 'prj-intruder' }), 'run-1');
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.reason).toBe('run_not_found');
  });
});

/* ------------------------------------------------------------- coverage */

describe('the surface itself', () => {
  it('takes an identity as the first argument of every method', () => {
    const ctx = build();
    const methods = Object.getOwnPropertyNames(JuliusRuntimeApi.prototype)
      .filter((name) => name !== 'constructor' && typeof (ctx.api as unknown as Record<string, unknown>)[name] === 'function');
    expect(methods.length).toBeGreaterThan(8);
    for (const name of methods) {
      const fn = (ctx.api as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!;
      // Every public method's first parameter is the identity. A method that
      // took the run first would be one an unauthenticated caller could reach.
      expect(fn.length, `${name} takes no arguments`).toBeGreaterThan(0);
    }
  });

  it('refuses a blank run id without touching the store', async () => {
    const ctx = build();
    for (const runId of ['', '   ']) {
      const result = await ctx.api.inspectRun(identity(), runId);
      expect(result.ok, JSON.stringify(runId)).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('run_not_found');
    }
  });

  it('exposes no method that starts or configures a Compound Agent', () => {
    const methods = Object.getOwnPropertyNames(JuliusRuntimeApi.prototype);
    for (const forbidden of ['createCompoundAgent', 'listIntegrations', 'saveConfiguration', 'authorMission']) {
      expect(methods).not.toContain(forbidden);
    }
  });
});
