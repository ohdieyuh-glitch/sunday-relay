import { describe, expect, it } from 'vitest';
import {
  defaultModePolicy, selectMode, buildAutonomousConsent, validateAutonomousAccess, actionRequiresStop,
  createCredentialHandle, handleIsActive, revokeHandle, evaluateHandleAccess, accessSummary,
  computeDogActivity, renderDogFrames,
  entitlementPolicy, computeOutputVisibility, reviewerIsIndependent, assignReviewer, buildReviewerPackage,
  projectTerminalEvent, redactTerminalText, createInProcessTerminalStream,
  type AutonomousAccessGrant, type DogComputeInput,
} from './index';

/**
 * Mission Control engine tests (Prompt 8.2) — PURE, no provider call, no
 * process. Modes / secure access / dog / terminal / reviewer.
 */

const T0 = '2026-07-24T00:00:00.000Z';
const LATER = '2026-07-24T02:00:00.000Z';

describe('operational modes', () => {
  it('has distinct deterministic defaults per mode with escalating limits', () => {
    const g = defaultModePolicy('guided', T0), s = defaultModePolicy('semi', T0), a = defaultModePolicy('autonomous', T0);
    expect(g.checkpointPolicy).toBe('ask_often');
    expect(s.checkpointPolicy).toBe('ask_high_impact');
    expect(a.checkpointPolicy).toBe('ask_boundary_only');
    expect(g.automaticStepLimit).toBeLessThan(s.automaticStepLimit);
    expect(s.automaticStepLimit).toBeLessThan(a.automaticStepLimit);
    expect(g.credentialHandlePolicy).toBe('disabled');
    expect(a.consentRequired).toBe(true);
    expect(g.automaticRepairLimit).toBe(1);
    expect(a.deploymentPolicy).toBe('preauthorized_only');
  });

  it('escalation to autonomous requires consent and mints an immutable event; reduction is immediate', () => {
    expect(selectMode('semi', 'autonomous', T0).ok).toBe(false); // no consent
    const grant: AutonomousAccessGrant = {
      services: ['github (read-only)'], projects: ['p'], tools: ['Read', 'Edit'], credentialHandleIds: [],
      maximumSpendUsd: 5, maximumRuntimeMinutes: 30, deploymentPermitted: false, destructiveActionPermitted: false,
      reviewerPolicy: 'required_when_entitled', expiresAt: LATER,
    };
    const consent = buildAutonomousConsent({ consentId: 'cns', grantedBy: 'op', grantedAt: T0, access: grant });
    expect(consent.ok).toBe(true);
    if (!consent.ok) return;
    const up = selectMode('semi', 'autonomous', T0, consent.value);
    expect(up.ok && up.value.event.immutable).toBe(true);
    expect(up.ok && up.value.event.consentId).toBe('cns');
    // reduction: no consent, immediate.
    const down = selectMode('autonomous', 'guided', T0);
    expect(down.ok && down.value.policy.mode).toBe('guided');
    expect(down.ok && down.value.event.immutable).toBe(false);
    // semi escalation needs no consent.
    expect(selectMode('guided', 'semi', T0).ok).toBe(true);
  });

  it('rejects an "access everything" grant and requires an expiration', () => {
    const base: AutonomousAccessGrant = { services: ['s'], projects: ['p'], tools: ['Read'], credentialHandleIds: [], maximumSpendUsd: 1, maximumRuntimeMinutes: 10, deploymentPermitted: false, destructiveActionPermitted: false, reviewerPolicy: 'required_when_entitled', expiresAt: LATER };
    expect(validateAutonomousAccess({ ...base, services: ['*'] }).length).toBeGreaterThan(0);
    expect(validateAutonomousAccess({ ...base, tools: ['all'] }).length).toBeGreaterThan(0);
    expect(validateAutonomousAccess({ ...base, expiresAt: '' }).length).toBeGreaterThan(0);
    expect(validateAutonomousAccess(base)).toEqual([]);
  });

  it('destructive/deployment/boundary actions stop even in autonomous; reviewer cannot be bypassed by mode', () => {
    expect(actionRequiresStop('autonomous', 'destructive_action')).toBe(true);
    expect(actionRequiresStop('autonomous', 'deployment')).toBe(true);
    expect(actionRequiresStop('autonomous', 'deployment', true)).toBe(false); // preauthorized
    expect(actionRequiresStop('autonomous', 'secret_export')).toBe(true);
    expect(actionRequiresStop('autonomous', 'multi_factor')).toBe(true);
    expect(actionRequiresStop('semi', 'new_spending')).toBe(true);
    // reviewer policy lives in the entitlement gate, not mode — autonomous
    // keeps reviewerPolicy required_when_entitled.
    expect(defaultModePolicy('autonomous', T0).reviewerPolicy).toBe('required_when_entitled');
  });
});

describe('secure access — credential handles', () => {
  const goodInput = {
    credentialHandleId: 'crd_1', userId: 'u', projectId: 'p', service: 'Claude Code', accountLabel: 'local',
    capability: 'authenticated_session' as const, allowedActions: ['edit'], scope: ['repo'], createdAt: T0,
    expiresAt: LATER, provenance: 'simulated' as const,
  };

  it('rejects raw passwords / secret-shaped keys and values', () => {
    expect(createCredentialHandle({ ...goodInput, password: 'hunter2' } as never).ok).toBe(false);
    expect(createCredentialHandle({ ...goodInput, apiKey: 'sk-FAKETESTNOTREAL0000' } as never).ok).toBe(false);
    expect(createCredentialHandle({ ...goodInput, note: 'token=sk-FAKETESTNOTREAL0000' } as never).ok).toBe(false);
    expect(createCredentialHandle(goodInput).ok).toBe(true);
  });

  it('supports a pre-authenticated session capability, scope, expiration, and revocation', () => {
    const h = createCredentialHandle(goodInput);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.value.capability).toBe('authenticated_session');
    expect(handleIsActive(h.value, T0)).toBe(true);
    expect(handleIsActive(h.value, '2026-07-25T00:00:00.000Z')).toBe(false); // expired
    const revoked = revokeHandle(h.value, T0);
    expect(handleIsActive(revoked, T0)).toBe(false);
  });

  it('multi-factor / presence stays a Manual Task; unauthorized scope is rejected', () => {
    const mfa = createCredentialHandle({ ...goodInput, requiresMultiFactor: true });
    expect(mfa.ok && evaluateHandleAccess(mfa.value, 'edit', T0)).toBe('requires_manual_task');
    const scoped = createCredentialHandle(goodInput);
    expect(scoped.ok && evaluateHandleAccess(scoped.value, 'deploy', T0)).toBe('not_in_scope');
    expect(scoped.ok && evaluateHandleAccess(scoped.value, 'edit', T0)).toBe('allowed');
  });

  it('the access summary contains names/scopes only — never values', () => {
    const h = createCredentialHandle(goodInput);
    const summary = accessSummary(h.ok ? [h.value] : [], T0);
    const json = JSON.stringify(summary);
    expect(json).toContain('Claude Code');
    expect(json).not.toMatch(/password|secret|sk-[A-Za-z0-9]{8,}|token[:=]/i);
  });
});

const evseq = (kinds: Array<[number, string, string]>): DogComputeInput['events'] =>
  kinds.map(([sequence, source, kind]) => ({ sequence, source, kind, provenance: 'simulated' as const }));

const dog = (over: Partial<DogComputeInput>) => computeDogActivity({
  events: [], runStatus: 'active', phase: 'implementation', mode: 'semi', manualTaskActive: false,
  checkpointActive: false, missionVerdict: 'none', reducedMotion: false, now: T0, provenance: 'simulated', ...over,
});

describe('relay dog activity engine', () => {
  it('derives each terminal/boundary state from run state, never fabricated', () => {
    expect(dog({ runStatus: 'created', events: [] }).state).toBe('wandering');
    expect(dog({ missionVerdict: 'verified_complete' }).state).toBe('complete');
    expect(dog({ runStatus: 'failed' }).state).toBe('failed');
    expect(dog({ runStatus: 'cancelled' }).state).toBe('stopped_safely');
    expect(dog({ runStatus: 'checkpoint_required' }).state).toBe('stopped_safely');
    expect(dog({ manualTaskActive: true }).state).toBe('waiting_for_user');
  });

  it('phase drives verifying / reviewing / repairing / handoff', () => {
    expect(dog({ phase: 'verification' }).state).toBe('verifying');
    expect(dog({ phase: 'review' }).state).toBe('reviewing');
    expect(dog({ phase: 'repair' }).state).toBe('repairing');
    expect(dog({ events: evseq([[1, 'relay-core', 'handoff.dispatched']]), phase: 'handoff' }).state).toBe('carrying_handoff');
  });

  it('sprinting requires sustained architect+coding coordination; slower states reflect lighter work', () => {
    // Handoffs earlier (counted toward sync), then a busy window of active
    // architect+coding work with no handoff in the recent window.
    const handoffs = evseq([[1, 'relay-core', 'handoff.created'], [2, 'relay-core', 'handoff.dispatched'], [3, 'relay-core', 'handoff.dispatched']]);
    const busy = evseq([
      [4, 'architect', 'architect.blueprint_created'], [5, 'coding-agent', 'agent.session_started'],
      [6, 'coding-agent', 'agent.report_created'], [7, 'architect', 'architect.revision_created'],
      [8, 'coding-agent', 'agent.report_created'], [9, 'architect', 'architect.blueprint_created'],
      [10, 'coding-agent', 'agent.report_created'], [11, 'architect', 'architect.revision_created'],
    ]);
    const sprint = dog({ events: handoffs.concat(busy), phase: 'implementation', windowSize: 8 });
    expect(sprint.state).toBe('sprinting');
    expect(sprint.statusLabel).toBe('SYNC HIGH');
    expect(dog({ events: evseq([[1, 'coding-agent', 'agent.report_created']]), phase: 'implementation' }).state).toBe('walking');
    // activity decays: an empty recent window after activity → idle.
    expect(dog({ events: evseq([[1, 'coding-agent', 'agent.report_created']]), runStatus: 'active', phase: 'implementation', windowSize: 8 }).activityLevel).toBeLessThan(30);
  });

  it('reduced motion is carried; frames render with a label', () => {
    const a = dog({ reducedMotion: true, phase: 'verification' });
    expect(a.reducedMotion).toBe(true);
    expect(renderDogFrames(a).at(-1)).toContain('VERIFYING');
  });
});

describe('reviewer entitlement + release gate', () => {
  it('entitlement policy: free has no reviewer; pro/max require it', () => {
    expect(entitlementPolicy('free').reviewerAvailable).toBe(false);
    expect(entitlementPolicy('pro').reviewerRequiredForSubstantiveCoding).toBe(true);
    expect(entitlementPolicy('max').specialistReviewers).toBe(true);
  });

  it('output cannot release before required independent review AND CompletionPolicy', () => {
    const base = { entitlement: 'pro' as const, substantiveCoding: true, implementationReported: true, reviewerRequired: true, reviewerIsIndependent: true, runStatus: 'active' };
    expect(computeOutputVisibility({ ...base, verificationPassed: false, reviewOccurred: false, blockingFindingOpen: false, reviewApproved: false, completionPolicySatisfied: false }).visibility).toBe('held_for_verification');
    expect(computeOutputVisibility({ ...base, verificationPassed: true, reviewOccurred: false, blockingFindingOpen: false, reviewApproved: false, completionPolicySatisfied: false }).visibility).toBe('held_for_review');
    expect(computeOutputVisibility({ ...base, verificationPassed: true, reviewOccurred: true, blockingFindingOpen: true, reviewApproved: false, completionPolicySatisfied: false }).visibility).toBe('revision_required');
    expect(computeOutputVisibility({ ...base, verificationPassed: true, reviewOccurred: true, blockingFindingOpen: false, reviewApproved: true, completionPolicySatisfied: false }).visibility).toBe('approved_for_release');
    expect(computeOutputVisibility({ ...base, verificationPassed: true, reviewOccurred: true, blockingFindingOpen: false, reviewApproved: true, completionPolicySatisfied: true }).visibility).toBe('released');
    // Free (no reviewer required) still gates on CompletionPolicy.
    expect(computeOutputVisibility({ entitlement: 'free', substantiveCoding: true, implementationReported: true, verificationPassed: true, reviewerRequired: false, reviewOccurred: false, blockingFindingOpen: false, reviewApproved: false, reviewerIsIndependent: false, completionPolicySatisfied: false, runStatus: 'active' }).visibility).toBe('approved_for_release');
  });

  it('reviewer independence is structural (never the same session/adapter/author)', () => {
    expect(reviewerIsIndependent({ reviewerAgentId: 'r', reviewerSessionId: 's2', reviewerAdapterId: 'ad2', reviewerIndependenceGroup: 'reviewers', implementerAgentId: 'c', implementerSessionId: 's1', implementerAdapterId: 'ad1', implementerIndependenceGroup: 'implementers' })).toBe(true);
    expect(reviewerIsIndependent({ reviewerAgentId: 'c', reviewerSessionId: 's1', reviewerAdapterId: 'ad1', reviewerIndependenceGroup: 'implementers', implementerAgentId: 'c', implementerSessionId: 's1', implementerAdapterId: 'ad1', implementerIndependenceGroup: 'implementers' })).toBe(false);
    expect(reviewerIsIndependent({ reviewerAgentId: 'r', reviewerSessionId: 's1', reviewerAdapterId: 'ad2', reviewerIndependenceGroup: 'reviewers', implementerAgentId: 'c', implementerSessionId: 's1', implementerAdapterId: 'ad1', implementerIndependenceGroup: 'implementers' })).toBe(false); // same session
  });

  it('reviewer is entitlement-locked on Free and labeled simulated otherwise', () => {
    expect(assignReviewer('free', 'simulated').availability).toBe('entitlement_locked');
    const r = assignReviewer('pro', 'simulated');
    expect(r.provenance).toBe('simulated');
    expect(r.agentId).toBe('sim-reviewer');
  });

  it('reviewer package excludes the transcript and secrets', () => {
    const pkg = buildReviewerPackage({ missionObjective: 'o', requirements: ['r'], acceptanceCriteria: ['c'], changedFiles: ['a.ts'], verificationEvidence: [{ command: 'node --test', status: 'passed' }] });
    const json = JSON.stringify(pkg);
    expect(json).not.toMatch(/transcript|chain of thought|sk-[A-Za-z0-9]{8,}|password/i);
    expect(pkg.reviewRubric.length).toBeGreaterThan(0);
  });
});

describe('live terminal read model', () => {
  it('redacts secrets and omits private reasoning', () => {
    expect(redactTerminalText('key sk-FAKETESTNOTREAL0000 here').redactions).toBeGreaterThan(0);
    const omitted = projectTerminalEvent({ sequence: 1, at: T0, source: 'coding-agent', kind: 'agent.report_created', safeSummary: 'my chain of thought: secret plan', provenance: 'simulated' });
    expect(omitted.omittedPrivateReasoning).toBe(true);
    expect(omitted.safeSummary).toBe('Private reasoning omitted.');
    const clean = projectTerminalEvent({ sequence: 2, at: T0, source: 'coding-agent', kind: 'agent.report_created', safeSummary: 'password=hunter2xyz here', provenance: 'simulated' });
    expect(clean.safeSummary).toContain('[redacted]');
  });

  it('the in-process transport orders events, suppresses duplicates, detects gaps, and reconnects', () => {
    const stream = createInProcessTerminalStream([
      { sequence: 1, at: T0, source: 'relay-core', kind: 'run.created', safeSummary: 'created', provenance: 'simulated' },
      { sequence: 1, at: T0, source: 'relay-core', kind: 'run.created', safeSummary: 'dup', provenance: 'simulated' }, // duplicate
      { sequence: 2, at: T0, source: 'relay-core', kind: 'run.started', safeSummary: 'started', provenance: 'simulated' },
      { sequence: 5, at: T0, source: 'coding-agent', kind: 'agent.report_created', safeSummary: 'report', provenance: 'simulated' }, // gap
    ]);
    stream.connect();
    expect(stream.connectionState).toBe('LIVE');
    const loaded = stream.loadSince(0);
    expect(loaded.events.map((e) => e.sequence)).toEqual([1, 2, 5]); // deduped + ordered
    expect(loaded.gapDetected).toBe(true);
    // recovery from last confirmed sequence.
    const since2 = stream.loadSince(2);
    expect(since2.events.map((e) => e.sequence)).toEqual([5]);
    stream.reconnect();
    expect(stream.connectionState).toBe('RECONNECTING');
  });
});
