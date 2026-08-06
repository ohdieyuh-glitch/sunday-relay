import { describe, expect, it } from 'vitest';

import {
  confirmLoopRunsForTarget,
  roleConfirmationRequestId,
  staffedRoleOf,
  type TargetConfirmationBase,
} from './loop-target-confirmation';
import {
  createInMemoryLoopBacking,
  emptyLoopBudget,
  loopConfirmationKey,
  loopDigest,
  confirmLoopRun,
  type LoopOperationDeps,
} from './index';
import type { RelayLoopTarget } from '../loop-target';

/**
 * `/loop all` — STAFFING A RESOLVED TARGET.
 *
 * What is tested is the fan-out discipline, not run creation — the store's own
 * suite proves that. Every defect this layer can add is a COLLAPSE defect: two
 * roles folding into one run, a retry minting a second team, an unavailable
 * role staffed on a missing answer, one failure silently cancelling the rest,
 * or N budgets rendered as one.
 */

const AT = '2026-08-06T15:00:00.000Z';

const BUDGET = emptyLoopBudget({
  maxIterations: 5,
  maxTotalDurationMinutes: 60,
  maxSpendMicros: '2500000',
  currency: 'USD',
  maxTotalTokens: 100_000,
  maxProviderCalls: 10,
  maxConsecutiveFailures: 3,
});

function target(over: Partial<RelayLoopTarget> = {}): RelayLoopTarget {
  return {
    selector: { kind: 'all_eligible_agents', requestedExpression: 'all', requestedRoles: [] },
    requestedRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
    resolvedRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
    unavailableRoles: [],
    assignments: [],
    registryProvenance: 'manual',
    resolvedAt: AT,
    ...over,
  };
}

function base(over: Partial<TargetConfirmationBase> = {}): TargetConfirmationBase {
  return {
    principal: 'founder',
    workspaceId: 'wsp_test',
    projectId: 'prj_test',
    loopId: 'lpe_team',
    contractRef: 'contract-ref',
    contractVersion: 1,
    contractBindingDigest: 'digest-1',
    confirmationRequestId: 'req_1',
    creationSource: 'cli',
    budget: BUDGET,
    provenance: 'simulated',
    ...over,
  };
}

const runIdFor = (key: string): string => `lpr_${loopDigest(key).slice(0, 32)}`;

function harness() {
  const inner = createInMemoryLoopBacking([]);
  // The backing deliberately has no enumeration, so creations are counted at
  // the seam: what this layer CREATED is the claim under test.
  const created: string[] = [];
  const backing: typeof inner = {
    ...inner,
    create: (record) => {
      inner.create(record);
      created.push(record.runId);
    },
  };
  let clock = 0;
  const deps: LoopOperationDeps = {
    backing,
    digest: loopDigest,
    now: () => new Date(Date.parse(AT) + (clock += 1000)).toISOString(),
  };
  return { created, deps };
}

describe('one run per resolved role', () => {
  it('staffs every resolved role with its OWN run under one Loop', () => {
    const { deps } = harness();
    const report = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });

    expect(report.staffed.map((s) => s.role))
      .toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
    expect(report.failed).toEqual([]);
    expect(report.unstaffed).toEqual([]);
    expect(report.runsAuthorized).toBe(3);

    // Three DISTINCT runs — two roles collapsing into one run is the
    // requested-versus-actual collapse this layer exists to prevent.
    // Mutation check: dropping the role from the derived request id makes
    // every key (and so every derived run id) identical, and this fails.
    const runIds = report.staffed.map((s) => s.run.runId);
    expect(new Set(runIds).size).toBe(3);
    const keys = report.staffed.map((s) => s.run.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    for (const s of report.staffed) {
      expect(s.run.loopId).toBe('lpe_team');
      expect(s.duplicate).toBe(false);
      expect(s.run.idempotencyKey)
        .toContain(roleConfirmationRequestId('req_1', s.role));
    }
  });

  it('a RETRY of the same decision converges to the same team, all duplicates', () => {
    const { created, deps } = harness();
    const first = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });
    const second = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });

    expect(second.staffed.map((s) => s.run.runId))
      .toEqual(first.staffed.map((s) => s.run.runId));
    expect(second.staffed.every((s) => s.duplicate)).toBe(true);
    expect(second.runsAuthorized).toBe(3);
    // No second team was minted anywhere.
    expect(created).toHaveLength(3);
  });

  it('a DIFFERENT decision creates a different team, not the first one relabelled', () => {
    const { created, deps } = harness();
    confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });
    const other = confirmLoopRunsForTarget(deps, {
      target: target(),
      base: base({ confirmationRequestId: 'req_2' }),
      runIdFor,
    });
    expect(other.staffed.every((s) => !s.duplicate)).toBe(true);
    expect(created).toHaveLength(6);
  });
});

describe('who is not staffed, and why it is said', () => {
  it('unavailable roles ride VERBATIM — unknown never staffs', () => {
    const { created, deps } = harness();
    const report = confirmLoopRunsForTarget(deps, {
      target: target({
        resolvedRoles: ['coding_agent'],
        unavailableRoles: [
          { role: 'reviewer', availability: 'unknown' },
          { role: 'prompt_architect', availability: 'not_connected' },
        ],
      }),
      base: base(),
      runIdFor,
    });
    expect(report.staffed.map((s) => s.role)).toEqual(['coding_agent']);
    expect(report.unstaffed).toEqual([
      { role: 'reviewer', availability: 'unknown' },
      { role: 'prompt_architect', availability: 'not_connected' },
    ]);
    expect(created).toHaveLength(1);
  });

  it('a target that resolved NOBODY creates nothing and says so', () => {
    const { created, deps } = harness();
    const report = confirmLoopRunsForTarget(deps, {
      target: target({
        resolvedRoles: [],
        unavailableRoles: [{ role: 'coding_agent', availability: 'not_configured' }],
      }),
      base: base(),
      runIdFor,
    });
    expect(report.staffed).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.runsAuthorized).toBe(0);
    expect(report.authorizedSpendMicrosTotal).toBe('0');
    expect(created).toEqual([]);
  });

  it('one role failing does NOT stop the roles after it', () => {
    const { deps } = harness();
    // Occupy the run id the FIRST role would derive, under a different
    // decision — its confirmation must answer idempotency_conflict.
    const firstRoleKey = loopConfirmationKey({
      principal: 'founder',
      workspaceId: 'wsp_test',
      projectId: 'prj_test',
      contractBindingDigest: 'digest-1',
      confirmationRequestId: roleConfirmationRequestId('req_1', 'prompt_architect'),
    });
    const squatter = confirmLoopRun(deps, {
      ...base({ confirmationRequestId: 'someone-elses-decision' }),
      runId: runIdFor(firstRoleKey),
    });
    expect(squatter.ok).toBe(true);

    const report = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });
    // Mutation check: returning at the first failure leaves coding_agent and
    // reviewer unstaffed and fails these.
    expect(report.failed).toEqual([
      {
        role: 'prompt_architect',
        status: 409,
        kind: 'idempotency_conflict',
        problem: 'A different confirmation already created a run with that id.',
      },
    ]);
    expect(report.staffed.map((s) => s.role)).toEqual(['coding_agent', 'reviewer']);
    expect(report.runsAuthorized).toBe(2);
  });

  it('accounts for every resolved role exactly once: staffed + failed, in order', () => {
    const { deps } = harness();
    const report = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });
    const seen = [...report.staffed.map((s) => s.role), ...report.failed.map((f) => f.role)];
    expect(seen.sort()).toEqual([...target().resolvedRoles].sort());
  });
});

describe('which role a run was created for is a contract, not an accident', () => {
  it('recovers each staffed run’s role from its durable key', () => {
    const { deps } = harness();
    const report = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });
    expect(report.staffed.map((s) => staffedRoleOf(s.run)))
      .toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
  });

  it('answers null for a run whose key names no known role — unknown is not guessed', () => {
    const { deps } = harness();
    // A single-role run confirmed WITHOUT this layer: its request id carries
    // no role suffix, and the decoder must say "unrecorded", not invent one.
    const legacy = confirmLoopRun(deps, { ...base(), runId: 'lpr_legacy' });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(staffedRoleOf(legacy.run)).toBeNull();

    // A suffix that is not a role is not a role.
    const odd = confirmLoopRun(deps, {
      ...base({ confirmationRequestId: 'req_9#security' }),
      runId: 'lpr_odd',
    });
    expect(odd.ok).toBe(true);
    if (odd.ok) expect(staffedRoleOf(odd.run)).toBeNull();
  });
});

describe('N budgets are not one budget', () => {
  it('totals the authorized spend caps across the team in integer micros', () => {
    const { deps } = harness();
    const report = confirmLoopRunsForTarget(deps, { target: target(), base: base(), runIdFor });
    // Three roles at 2_500_000 micros each: the decision authorized 7.5, not
    // 2.5 — a `/loop all` that displays one budget understates by N times.
    expect(report.authorizedSpendMicrosTotal).toBe('7500000');
  });

  it('an UNBOUNDED cap anywhere makes the total null, never a bounded-looking number', () => {
    const { deps } = harness();
    const unbounded = emptyLoopBudget({
      maxIterations: 5,
      maxTotalDurationMinutes: 60,
      maxSpendMicros: null,
      currency: 'USD',
      maxTotalTokens: 100_000,
      maxProviderCalls: 10,
      maxConsecutiveFailures: 3,
    });
    const report = confirmLoopRunsForTarget(deps, {
      target: target(),
      base: base({ budget: unbounded }),
      runIdFor,
    });
    expect(report.authorizedSpendMicrosTotal).toBeNull();
  });
});
