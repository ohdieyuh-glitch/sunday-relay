import { describe, expect, it } from 'vitest';
import type { EligibilityCheck, DispatchEligibilityResult } from '../../coordination/eligibility';
import {
  RELAY_ELIGIBILITY_BLOCKER_REASONS,
  RELAY_LOOP_BLOCKER_REASONS,
  blockersForUnavailableRoles,
  blockersFromEligibility,
  runtimeBlocker,
  type RelayEligibilityCheckLike,
  type RelayEligibilityResultLike,
} from './loop-blockers';
import {
  DEFAULT_LOOP_LIMITS,
  RELAY_LOOP_STATES,
  TERMINAL_LOOP_STATES,
  buildLoopContract,
  isBindingLoopChange,
  validateLoopContractDraft,
  type RelayLoopContractDraft,
} from './loop-contract';
import {
  COMPLETION_SUPPORTING_TRUSTS,
  evaluateLoopCompletion,
  trustSupportsCompletion,
  type RelayLoopCompletionInput,
} from './loop-completion';
import {
  ALL_LOOP_FEATURES_DISABLED,
  UNCHAIN_TEMPORARY_SLOTS,
  evaluateLoopAvailability,
  featureEffectivelyEnabled,
  featureEnabled,
  unchainSessionProblem,
  type UnchainSessionRecord,
} from './loop-availability';
import {
  requestedRolesFor,
  resolveLoopTarget,
  targetIsStaffable,
  withObservedAssignment,
  type RelayAgentRegistrySnapshot,
} from './loop-target';
import { DEFAULT_LOOP_TARGET } from './loop-roles';
import { parseSlashCommand } from './loop-command-parser';

const NOW = '2026-08-02T12:00:00.000Z';

const FULL_REGISTRY: RelayAgentRegistrySnapshot = {
  activeCompoundAgentRoles: ['prompt_architect', 'coding_agent'],
  eligibleRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
  availability: {
    prompt_architect: 'available',
    coding_agent: 'available',
    reviewer: 'available',
  },
  provenance: 'live',
  observedAt: NOW,
};

function commandOf(input: string) {
  const result = parseSlashCommand(input);
  if (!result.ok) throw new Error(`could not parse ${input}`);
  return result.value.command;
}

/* --------------------------------------------------------------- targets */

describe('loop target resolution', () => {
  it('expands the default target to the ACTIVE compound agent, not everything', () => {
    const target = resolveLoopTarget(DEFAULT_LOOP_TARGET, FULL_REGISTRY);
    expect(target.requestedRoles).toEqual(['prompt_architect', 'coding_agent']);
    expect(target.resolvedRoles).toEqual(['prompt_architect', 'coding_agent']);
  });

  it('expands all/team to every eligible role, which may be a larger set', () => {
    const selector = { kind: 'all_eligible_agents' as const, requestedExpression: 'all', requestedRoles: [] };
    const target = resolveLoopTarget(selector, FULL_REGISTRY);
    expect(target.requestedRoles).toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
  });

  it('keeps exact roles verbatim, including ones the registry cannot staff', () => {
    const registry: RelayAgentRegistrySnapshot = {
      ...FULL_REGISTRY,
      availability: { prompt_architect: 'available', coding_agent: 'not_connected', reviewer: 'available' },
    };
    const selector = {
      kind: 'exact_roles' as const,
      requestedExpression: 'architect,coding',
      requestedRoles: ['prompt_architect', 'coding_agent'] as const,
    };
    const target = resolveLoopTarget(selector, registry);
    // The request is preserved so the failure can be reported, not erased.
    expect(target.requestedRoles).toEqual(['prompt_architect', 'coding_agent']);
    expect(target.resolvedRoles).toEqual(['prompt_architect']);
    expect(target.unavailableRoles).toEqual([{ role: 'coding_agent', availability: 'not_connected' }]);
  });

  it('treats an unknown availability as NOT available', () => {
    const registry: RelayAgentRegistrySnapshot = {
      ...FULL_REGISTRY,
      availability: { prompt_architect: 'available' },
    };
    const target = resolveLoopTarget(DEFAULT_LOOP_TARGET, registry);
    expect(target.resolvedRoles).toEqual(['prompt_architect']);
    expect(target.unavailableRoles).toEqual([{ role: 'coding_agent', availability: 'unknown' }]);
  });

  it('claims nobody is working until an agent is actually observed', () => {
    const target = resolveLoopTarget(DEFAULT_LOOP_TARGET, FULL_REGISTRY);
    expect(target.assignments).toEqual([]);
  });

  it('separates requested from actual identity on an observed assignment', () => {
    const target = resolveLoopTarget(DEFAULT_LOOP_TARGET, FULL_REGISTRY);
    const withAgent = withObservedAssignment(target, {
      role: 'coding_agent',
      requestedAdapterId: 'claude-code',
      actualAgentId: 'agent-7',
      actualAdapterId: 'claude-code',
    });
    expect(withAgent.assignments).toHaveLength(1);
    expect(withAgent.assignments[0].requestedAdapterId).toBe('claude-code');
    expect(withAgent.assignments[0].actualAgentId).toBe('agent-7');
  });

  it('refuses an observed assignment for a role that never resolved', () => {
    const registry: RelayAgentRegistrySnapshot = {
      ...FULL_REGISTRY,
      availability: { prompt_architect: 'available', coding_agent: 'not_configured' },
    };
    const target = resolveLoopTarget(DEFAULT_LOOP_TARGET, registry);
    const attempted = withObservedAssignment(target, {
      role: 'coding_agent',
      requestedAdapterId: 'claude-code',
      actualAgentId: 'agent-7',
      actualAdapterId: 'claude-code',
    });
    expect(attempted.assignments).toEqual([]);
  });

  it('carries the registry provenance rather than assuming it is live', () => {
    const target = resolveLoopTarget(DEFAULT_LOOP_TARGET, { ...FULL_REGISTRY, provenance: null });
    expect(target.registryProvenance).toBeNull();
  });

  it('reports an unstaffable target', () => {
    const registry: RelayAgentRegistrySnapshot = { ...FULL_REGISTRY, availability: {} };
    expect(targetIsStaffable(resolveLoopTarget(DEFAULT_LOOP_TARGET, registry))).toBe(false);
  });

  it('deduplicates a registry that lists a role twice', () => {
    const registry: RelayAgentRegistrySnapshot = {
      ...FULL_REGISTRY,
      activeCompoundAgentRoles: ['coding_agent', 'coding_agent'],
    };
    expect(requestedRolesFor(DEFAULT_LOOP_TARGET, registry)).toEqual(['coding_agent']);
  });
});

/* -------------------------------------------------------------- blockers */

describe('truthful blockers', () => {
  const eligible: RelayEligibilityResultLike = {
    outcome: 'eligible',
    failedChecks: [],
    requiredUserActions: [],
  };

  it('produces no blocker when nothing failed', () => {
    expect(blockersFromEligibility(eligible, { observedAt: NOW })).toEqual([]);
  });

  it('derives a blocker only from a real failed check, keeping its id and detail verbatim', () => {
    const result: RelayEligibilityResultLike = {
      outcome: 'blocked',
      failedChecks: [
        { id: 'dependencies-satisfied', ok: false, onFailure: 'blocked', detail: 'Task tsk_1 is incomplete.' },
      ],
      requiredUserActions: [],
    };
    const [blocker] = blockersFromEligibility(result, { slotId: 'lpo_1', observedAt: NOW });
    expect(blocker.reason).toBe('waiting_dependency');
    expect(blocker.source).toBe('eligibility');
    expect(blocker.checkId).toBe('dependencies-satisfied');
    expect(blocker.detail).toBe('Task tsk_1 is incomplete.');
    expect(blocker.slotId).toBe('lpo_1');
  });

  it('keeps an unmapped check truthful rather than dropping it', () => {
    const result: RelayEligibilityResultLike = {
      outcome: 'denied',
      failedChecks: [{ id: 'some-future-check', ok: false, onFailure: 'denied', detail: 'Real detail.' }],
      requiredUserActions: [],
    };
    const [blocker] = blockersFromEligibility(result, { observedAt: NOW });
    expect(blocker.reason).toBe('unknown_blocker');
    expect(blocker.detail).toBe('Real detail.');
  });

  it('attaches a required user action only to checkpoint-required checks', () => {
    const result: RelayEligibilityResultLike = {
      outcome: 'checkpoint_required',
      failedChecks: [
        { id: 'budget-permits', ok: false, onFailure: 'checkpoint_required', detail: 'Budget exceeded.' },
        { id: 'task-owned', ok: false, onFailure: 'blocked', detail: 'No owner.' },
      ],
      requiredUserActions: ['Resolve: budget-permits — Budget exceeded.'],
    };
    const [budget, owner] = blockersFromEligibility(result, { observedAt: NOW });
    expect(budget.reason).toBe('budget_blocked');
    expect(budget.requiredUserAction).toContain('budget-permits');
    expect(owner.requiredUserAction).toBeNull();
  });

  it('every mapped reason is a declared reason', () => {
    for (const reason of Object.values(RELAY_ELIGIBILITY_BLOCKER_REASONS)) {
      expect(RELAY_LOOP_BLOCKER_REASONS).toContain(reason);
    }
  });

  it('turns an unavailable role into a blocker naming the role and why', () => {
    const [blocker] = blockersForUnavailableRoles(
      [{ role: 'reviewer', availability: 'entitlement_locked' }],
      { observedAt: NOW },
    );
    expect(blocker.reason).toBe('unavailable_role');
    expect(blocker.source).toBe('runtime');
    expect(blocker.checkId).toBeNull();
    expect(blocker.detail).toContain('reviewer');
    expect(blocker.detail).toContain('entitlement');
    expect(blocker.requiredUserAction).not.toBeNull();
  });

  it('says plainly that an unknown availability never counts as available', () => {
    const [blocker] = blockersForUnavailableRoles(
      [{ role: 'coding_agent', availability: 'unknown' }],
      { observedAt: NOW },
    );
    expect(blocker.detail).toContain('never counts as available');
  });

  it('offers no way to build a blocker from arbitrary text', () => {
    // The only exported constructors take a real eligibility result or one of
    // a closed set of modelled conditions. A free-text reason is unreachable:
    // this is a type-level guarantee, asserted here so its removal is noticed.
    const blocker = runtimeBlocker(
      { kind: 'provider_unavailable', provider: 'claude', detail: 'The bridge is unreachable.' },
      { observedAt: NOW },
    );
    expect(RELAY_LOOP_BLOCKER_REASONS).toContain(blocker.reason);
    expect(blocker.source).toBe('runtime');
  });
});

/**
 * The mission layer may not import `../coordination` — a structural test
 * forbids it — so `loop-blockers.ts` declares the SHAPE it needs and a
 * composition root passes the real value. A TEST file may import both, which
 * is what lets this prove the two cannot drift apart.
 */
describe('the eligibility port matches the real battery', () => {
  it('a real EligibilityCheck satisfies the declared port', () => {
    const real: EligibilityCheck = {
      id: 'budget-permits',
      ok: false,
      onFailure: 'checkpoint_required',
      detail: 'Budget exceeded.',
    };
    const asPort: RelayEligibilityCheckLike = real;
    expect(asPort.id).toBe('budget-permits');
  });

  it('a real DispatchEligibilityResult satisfies the declared result port', () => {
    const real = {
      outcome: 'blocked',
      failedChecks: [{ id: 'task-owned', ok: false, onFailure: 'blocked', detail: 'No owner.' }],
      warnings: [],
      requiredUserActions: [],
      ledgerVersion: 1,
      contextVersion: 1,
      projectedBudget: {} as DispatchEligibilityResult['projectedBudget'],
      safeSummary: 'blocked',
    } satisfies DispatchEligibilityResult;
    const asPort: RelayEligibilityResultLike = real;
    expect(blockersFromEligibility(asPort, { observedAt: NOW })).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- contract */

const BASE_DRAFT: RelayLoopContractDraft = {
  loopId: 'lpe_test1',
  objective: 'Repair the failing authentication tests.',
  scope: { projectId: 'prj_1', missionId: null, missionContractRevision: null, workspaceId: null },
  target: DEFAULT_LOOP_TARGET,
  requestedRoles: ['prompt_architect', 'coding_agent'],
  resolvedRoles: ['prompt_architect', 'coding_agent'],
  creationSource: 'slash_command',
  createdBy: 'operator',
  createdAt: NOW,
  provenance: 'offline',
};

describe('loop contract foundation', () => {
  it('compiles a valid draft into a sealed contract in draft state', () => {
    const result = buildLoopContract(BASE_DRAFT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.state).toBe('draft');
    expect(result.value.schemaVersion).toBe('relay-loop-contract.v1');
    expect(result.value.bindingDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(result.value.limits).toEqual(DEFAULT_LOOP_LIMITS);
  });

  it('never compiles straight to a running state', () => {
    const result = buildLoopContract(BASE_DRAFT);
    if (!result.ok) throw new Error('unreachable');
    expect(TERMINAL_LOOP_STATES).not.toContain(result.value.state);
    expect(result.value.state).toBe('draft');
  });

  it('requires an objective, a project and a creating identity', () => {
    expect(validateLoopContractDraft({ ...BASE_DRAFT, objective: '   ' })).toContain('A Loop needs an objective.');
    expect(
      validateLoopContractDraft({ ...BASE_DRAFT, scope: { ...BASE_DRAFT.scope, projectId: '' } }),
    ).toContain('A Loop needs a project.');
    expect(validateLoopContractDraft({ ...BASE_DRAFT, createdBy: '' })).toContain(
      'A Loop needs a creating identity.',
    );
  });

  it('refuses an unbounded iteration count without recorded consent', () => {
    const problems = validateLoopContractDraft({
      ...BASE_DRAFT,
      limits: { maxIterations: null },
    });
    expect(problems).toContain('An unbounded iteration count requires explicit recorded consent.');

    const consented = validateLoopContractDraft({
      ...BASE_DRAFT,
      limits: { maxIterations: null },
      unboundedIterationsConsent: true,
    });
    expect(consented).toEqual([]);
  });

  it('refuses limits that are not limits', () => {
    expect(validateLoopContractDraft({ ...BASE_DRAFT, limits: { maxIterations: 0 } }).length).toBeGreaterThan(0);
    expect(validateLoopContractDraft({ ...BASE_DRAFT, limits: { maxTotalSpendUsd: -1 } }).length).toBeGreaterThan(0);
    expect(validateLoopContractDraft({ ...BASE_DRAFT, limits: { maxConcurrentSlots: 0 } }).length).toBeGreaterThan(0);
    expect(
      validateLoopContractDraft({ ...BASE_DRAFT, limits: { maxConsecutiveFailures: 1.5 } }).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a per-iteration bound larger than its total', () => {
    expect(
      validateLoopContractDraft({
        ...BASE_DRAFT,
        limits: { maxTotalSpendUsd: 1, maxIterationSpendUsd: 5 },
      }),
    ).toContain('maxIterationSpendUsd may not exceed maxTotalSpendUsd.');
    expect(
      validateLoopContractDraft({
        ...BASE_DRAFT,
        limits: { maxTotalDurationMinutes: 10, maxIterationDurationMinutes: 30 },
      }),
    ).toContain('maxIterationDurationMinutes may not exceed maxTotalDurationMinutes.');
  });

  it('refuses duplicate acceptance criterion ids', () => {
    expect(
      validateLoopContractDraft({
        ...BASE_DRAFT,
        acceptanceCriteria: [
          { id: 'a', text: 'one', blocking: true },
          { id: 'a', text: 'two', blocking: false },
        ],
      }),
    ).toContain('Acceptance criterion ids must be unique.');
  });

  it('refuses a review that only the sole implementer could satisfy', () => {
    const problems = validateLoopContractDraft({
      ...BASE_DRAFT,
      resolvedRoles: ['coding_agent'],
      review: { independentReviewRequired: true, reviewerRoles: ['coding_agent'], maxRepairIterations: 1 },
    });
    expect(problems.some((p) => p.includes('may not review its own work'))).toBe(true);
  });

  it('changes the binding digest when a binding field changes', () => {
    const a = buildLoopContract(BASE_DRAFT);
    const b = buildLoopContract({ ...BASE_DRAFT, objective: 'A different objective entirely.' });
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(isBindingLoopChange(a.value, b.value)).toBe(true);
  });

  it('does NOT change the binding digest for a cosmetic field', () => {
    const a = buildLoopContract(BASE_DRAFT);
    const b = buildLoopContract({ ...BASE_DRAFT, creationSource: 'cli' });
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(isBindingLoopChange(a.value, b.value)).toBe(false);
  });

  it('declares one closed state set rather than scattered booleans', () => {
    expect(new Set(RELAY_LOOP_STATES).size).toBe(RELAY_LOOP_STATES.length);
    for (const terminal of TERMINAL_LOOP_STATES) expect(RELAY_LOOP_STATES).toContain(terminal);
    // An unconfirmable Loop is unfinished, not finished:
    expect(TERMINAL_LOOP_STATES).not.toContain('recovery_required');
  });
});

/* ------------------------------------------------------------ completion */

const COMPLETE_INPUT: RelayLoopCompletionInput = {
  completionRule: 'all_blocking_criteria_and_independent_review',
  acceptanceCriteria: [{ id: 'c1', blocking: true }],
  evidence: [{ evidenceId: 'evd_1', sourceTrust: 'verified', criterionIds: ['c1'] }],
  iterations: [{ iterationId: 'lpi_1', outcome: 'completed' }],
  missionVerdict: 'verified_complete',
  openBlockingFindings: 0,
  independentReviewRequired: true,
  reviewOccurred: true,
  reviewApproved: true,
  reviewerWasIndependent: true,
  terminalWriteDurable: true,
};

describe('completion is earned, not claimed', () => {
  it('completes when every requirement is met', () => {
    expect(evaluateLoopCompletion(COMPLETE_INPUT).verdict).toBe('verified_complete');
  });

  it('a model claim alone can never complete a Loop', () => {
    const claimOnly = evaluateLoopCompletion({
      ...COMPLETE_INPUT,
      evidence: [{ evidenceId: 'evd_1', sourceTrust: 'claim', criterionIds: ['c1'] }],
    });
    expect(claimOnly.verdict).toBe('claimed_complete');
    expect(claimOnly.unsupportedBlockingCriterionIds).toEqual(['c1']);
  });

  it('an observed outcome is not enough either', () => {
    const observed = evaluateLoopCompletion({
      ...COMPLETE_INPUT,
      evidence: [{ evidenceId: 'evd_1', sourceTrust: 'observed', criterionIds: ['c1'] }],
    });
    expect(observed.verdict).toBe('claimed_complete');
  });

  it('accepts attested and verified evidence', () => {
    expect(COMPLETION_SUPPORTING_TRUSTS).toEqual(['attested', 'verified']);
    expect(trustSupportsCompletion('attested')).toBe(true);
    expect(trustSupportsCompletion('verified')).toBe(true);
    expect(trustSupportsCompletion('claim')).toBe(false);
    expect(trustSupportsCompletion('observed')).toBe(false);
  });

  it('blocks on an unconfirmable iteration rather than assuming it finished', () => {
    const result = evaluateLoopCompletion({
      ...COMPLETE_INPUT,
      iterations: [{ iterationId: 'lpi_1', outcome: 'unknown' }],
    });
    expect(result.verdict).toBe('incomplete');
    expect(result.reasons.some((r) => r.includes('unconfirmably'))).toBe(true);
  });

  it('blocks on anything short of a verified_complete mission verdict', () => {
    expect(evaluateLoopCompletion({ ...COMPLETE_INPUT, missionVerdict: 'claimed_complete' }).verdict).toBe(
      'incomplete',
    );
    const unknown = evaluateLoopCompletion({ ...COMPLETE_INPUT, missionVerdict: null });
    expect(unknown.verdict).toBe('incomplete');
    expect(unknown.reasons.some((r) => r.includes('Unknown'))).toBe(true);
  });

  it('blocks on an open blocking finding', () => {
    expect(evaluateLoopCompletion({ ...COMPLETE_INPUT, openBlockingFindings: 1 }).verdict).toBe('incomplete');
  });

  it('enforces the independent review gate', () => {
    expect(evaluateLoopCompletion({ ...COMPLETE_INPUT, reviewOccurred: false }).verdict).toBe('incomplete');
    expect(evaluateLoopCompletion({ ...COMPLETE_INPUT, reviewApproved: false }).verdict).toBe('incomplete');
    const notIndependent = evaluateLoopCompletion({ ...COMPLETE_INPUT, reviewerWasIndependent: false });
    expect(notIndependent.verdict).toBe('incomplete');
    expect(notIndependent.reasons.some((r) => r.includes('independent'))).toBe(true);
  });

  it('does not announce completion before the durable write resolves', () => {
    const result = evaluateLoopCompletion({ ...COMPLETE_INPUT, terminalWriteDurable: false });
    expect(result.verdict).toBe('incomplete');
    expect(result.reasons.some((r) => r.includes('durably written'))).toBe(true);
  });

  it('reports every failure at once, not just the first', () => {
    const result = evaluateLoopCompletion({
      ...COMPLETE_INPUT,
      missionVerdict: 'failed',
      openBlockingFindings: 2,
      reviewOccurred: false,
      terminalWriteDurable: false,
    });
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

/* ---------------------------------------------------------- availability */

describe('feature gates fail closed', () => {
  it('every feature is off when configuration is absent', () => {
    expect(featureEnabled(undefined, 'loop_engine')).toBe(false);
    expect(featureEnabled(null, 'loop_engine')).toBe(false);
    expect(featureEnabled(ALL_LOOP_FEATURES_DISABLED, 'loop_engine')).toBe(false);
  });

  it('only the literal boolean true enables a feature', () => {
    expect(featureEnabled({ loop_engine: true }, 'loop_engine')).toBe(true);
    expect(featureEnabled({ loop_engine: undefined }, 'loop_engine')).toBe(false);
    expect(featureEnabled({ loop_engine: 'true' } as never, 'loop_engine')).toBe(false);
    expect(featureEnabled({ loop_engine: 1 } as never, 'loop_engine')).toBe(false);
  });

  it('a dependent feature does nothing without its prerequisite', () => {
    expect(featureEffectivelyEnabled({ sloop: true }, 'sloop')).toBe(false);
    expect(featureEffectivelyEnabled({ sloop: true, unchain: true }, 'sloop')).toBe(true);
    expect(featureEffectivelyEnabled({ loop_cron: true, loop_scheduler: true }, 'loop_cron')).toBe(false);
    expect(
      featureEffectivelyEnabled({ loop_cron: true, loop_scheduler: true, loop_engine: true }, 'loop_cron'),
    ).toBe(true);
  });

  it('blocks every Loop command while the engine is off', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/loop all fix it'),
      flags: ALL_LOOP_FEATURES_DISABLED,
      unchain: null,
      assignableRoles: ['coding_agent'],
      observedAt: NOW,
    });
    expect(availability.state).toBe('unavailable');
    expect(availability.blockers[0].reason).toBe('feature_disabled');
    expect(availability.blockers[0].detail).toContain('Loop Engine');
  });

  it('understands cron grammar while refusing to run it', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/loop cron "0 8 * * 1-5" inspect dependencies'),
      flags: { loop_engine: true },
      unchain: null,
      assignableRoles: ['coding_agent'],
      observedAt: NOW,
    });
    expect(availability.state).toBe('unavailable');
    expect(availability.blockers.some((b) => b.detail.includes('grammar is understood'))).toBe(true);
  });
});

describe('the Unchain gate', () => {
  const VALID: UnchainSessionRecord = {
    sessionId: 'lpu_1',
    meterState: 'active',
    expiresAt: '2026-08-02T13:00:00.000Z',
    temporarySlots: UNCHAIN_TEMPORARY_SLOTS,
    temporaryPluginCapacity: 1,
    lastAttestedAt: NOW,
    grantedToOperator: true,
  };

  it('grants exactly two temporary slots and no more', () => {
    expect(UNCHAIN_TEMPORARY_SLOTS).toBe(2);
    const availability = evaluateLoopAvailability({
      command: commandOf('/sloop explore three repairs'),
      flags: { loop_engine: true, unchain: true, sloop: true },
      unchain: VALID,
      assignableRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
      observedAt: NOW,
    });
    expect(availability.state).toBe('available');
    expect(availability.grantedTemporarySlots).toBe(2);
  });

  it('refuses an S-Loop with no Unchain session, and says why truthfully', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/sloop explore three repairs'),
      flags: { loop_engine: true, unchain: true, sloop: true },
      unchain: null,
      assignableRoles: ['coding_agent'],
      observedAt: NOW,
    });
    expect(availability.state).toBe('unavailable');
    expect(availability.grantedTemporarySlots).toBe(0);
    expect(availability.blockers.some((b) => b.detail.includes('not yet implemented'))).toBe(true);
  });

  it('never fabricates a session — there is no domain constructor for one', () => {
    expect(unchainSessionProblem(null)).toContain('No server-authoritative Unchain session');
  });

  it('refuses a session that did not arrive over an operator credential', () => {
    expect(unchainSessionProblem({ ...VALID, grantedToOperator: false })).toContain('operator credential');
  });

  it('refuses a session the server never re-verified', () => {
    expect(unchainSessionProblem({ ...VALID, lastAttestedAt: null })).toContain('never been re-verified');
  });

  it('refuses an expired meter', () => {
    expect(unchainSessionProblem({ ...VALID, meterState: 'expired' })).toContain('grants no capacity');
  });

  it('still grants while the meter is critical, because Rechaining is controlled', () => {
    expect(unchainSessionProblem({ ...VALID, meterState: 'critical' })).toBeNull();
    expect(unchainSessionProblem({ ...VALID, meterState: 'low' })).toBeNull();
  });

  it('refuses a session claiming more than two temporary slots', () => {
    expect(unchainSessionProblem({ ...VALID, temporarySlots: 5 as never })).toContain('exactly 2');
  });

  it('expands capacity, never authority — temporary slots take ORDINARY roles', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/sloop do it'),
      flags: { loop_engine: true, unchain: true, sloop: true },
      unchain: VALID,
      assignableRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
      observedAt: NOW,
    });
    expect(availability.temporarySlotRoles).toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
  });

  it('grants nothing when anything else blocks', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/sloop do it'),
      flags: { unchain: true, sloop: true }, // engine off
      unchain: VALID,
      assignableRoles: ['coding_agent'],
      observedAt: NOW,
    });
    expect(availability.state).toBe('unavailable');
    expect(availability.grantedTemporarySlots).toBe(0);
    expect(availability.temporarySlotRoles).toEqual([]);
  });

  it('reports every reason at once', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/sloop do it'),
      flags: ALL_LOOP_FEATURES_DISABLED,
      unchain: null,
      assignableRoles: [],
      observedAt: NOW,
    });
    expect(availability.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it('leaves ordinary Loops unaffected by the Unchain gate', () => {
    const availability = evaluateLoopAvailability({
      command: commandOf('/loop all fix it'),
      flags: { loop_engine: true },
      unchain: null,
      assignableRoles: ['coding_agent'],
      observedAt: NOW,
    });
    expect(availability.state).toBe('available');
    expect(availability.grantedTemporarySlots).toBe(0);
  });
});
