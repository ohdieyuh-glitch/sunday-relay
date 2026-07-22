import { describe, expect, it } from 'vitest';
import {
  buildMissionContract, validateMissionSpec, isBindingChange, handoffIsStale, stableDigest,
  buildExecutionAttestation, attestsSuccessfulExecution, hasAttestedExecutionBy,
  projectReviewLedger, reviewHasActionableFinding, repairExpandsFileClaims, openBlockingFindings,
  evaluateMissionVerdict, buildMissionTimeline,
  type MissionSpec, type ReviewInput, type ExecutionFacts, type MissionVerdictInput,
} from './index';

/**
 * Mission-layer projection tests (Prompt 8.1) — PURE, no provider call, no
 * process, no Node fs. Covers mission contract validation/revisioning,
 * execution attestation, finding/repair ledger, deterministic verdicts, and
 * the timeline.
 */

const T0 = '2026-07-23T12:00:00.000Z';

const validSpec = (over: Partial<MissionSpec> = {}): MissionSpec => ({
  title: 'Protect anonymous access',
  objective: 'Prevent one actor from bypassing identity limits or spending controls.',
  requirements: ['Durable anonymous rate limiting', 'IPv6 identity aggregation'],
  constraints: ['No pricing redesign'],
  acceptanceCriteria: [
    { id: 'AC-1', text: 'Rate-limit proof passes.', blocking: true },
    { id: 'AC-2', text: 'Docs updated.', blocking: false },
  ],
  filesInScope: ['src/access/anonymous-policy.ts'],
  filesOutOfScope: ['src/pricing'],
  systemsInScope: ['anonymous policy'],
  systemsOutOfScope: ['Alcatraz engine'],
  assumptions: [], decisions: [], unresolvedQuestions: [],
  requiredEvidence: ['30/30 rate-limit proof'],
  requiredReviewers: ['Codex — Independent Coding Reviewer'],
  implementerRequirement: 'Claude Code',
  reviewerRequirement: 'Codex — Independent Coding Reviewer',
  maximumRepairIterations: 1, maximumReviewRuns: 2, maximumCostUsd: 2, maximumRuntimeMinutes: 30,
  completionRule: 'all_blocking_criteria_and_independent_review',
  createdBy: 'relay-operator',
  ...over,
});

const build = (spec: MissionSpec, over: Partial<Parameters<typeof buildMissionContract>[0]> = {}) =>
  buildMissionContract({ spec, missionId: 'msn_1', projectId: 'prj_1', now: T0, provenance: 'simulated', ...over });

describe('mission contract validation + revisioning', () => {
  it('accepts a valid mission and attributes the actor', () => {
    const r = build(validSpec());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.revision).toBe(1);
      expect(r.value.createdBy).toBe('relay-operator');
      expect(r.value.updatedBy).toBe('relay-operator');
      expect(r.value.bindingDigest.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing objective, no blocking criteria, missing out-of-scope', () => {
    expect(build(validSpec({ objective: '' })).ok).toBe(false);
    expect(build(validSpec({ acceptanceCriteria: [{ id: 'AC-1', text: 'x', blocking: false }] })).ok).toBe(false);
    expect(build(validSpec({ filesOutOfScope: [], systemsOutOfScope: [] })).ok).toBe(false);
    expect(validateMissionSpec(validSpec({ requirements: [] })).length).toBeGreaterThan(0);
  });

  it('rejects secret and hidden-reasoning content', () => {
    expect(build(validSpec({ decisions: ['api_key=sk-FAKETESTNOTREAL0009'] })).ok).toBe(false);
    expect(build(validSpec({ assumptions: ['see the chain of thought'] })).ok).toBe(false);
  });

  it('rejects a non-positive revision', () => {
    expect(build(validSpec(), { revision: 0 }).ok).toBe(false);
  });

  it('a binding change increments/stales; a display-only change does not', () => {
    const rev1 = build(validSpec());
    if (!rev1.ok) throw new Error('rev1 must build');
    // Binding change: add a requirement.
    const bindingSpec = validSpec({ requirements: ['Durable anonymous rate limiting', 'IPv6 identity aggregation', 'Zero dispatch after block'] });
    expect(isBindingChange(rev1.value, bindingSpec, { missionId: 'msn_1', projectId: 'prj_1', now: T0, provenance: 'simulated' })).toBe(true);
    const rev2 = build(bindingSpec, { revision: 2, updatedBy: 'architect' });
    expect(rev2.ok && rev2.value.revision).toBe(2);
    expect(rev2.ok && rev2.value.bindingDigest).not.toBe(rev1.value.bindingDigest);
    // A handoff pinned to rev1's digest is stale against rev2.
    expect(rev2.ok && handoffIsStale(rev2.value, rev1.value.bindingDigest)).toBe(true);

    // Display-only change: title/assumptions — digest unchanged, not stale.
    const displaySpec = validSpec({ title: 'A different display title', assumptions: ['extra note'] });
    expect(isBindingChange(rev1.value, displaySpec, { missionId: 'msn_1', projectId: 'prj_1', now: T0, provenance: 'simulated' })).toBe(false);
    const displayBuild = build(displaySpec);
    expect(displayBuild.ok && handoffIsStale(displayBuild.value, rev1.value.bindingDigest)).toBe(false);
  });

  it('previous revisions remain independently inspectable', () => {
    const rev1 = build(validSpec());
    const rev2 = build(validSpec({ constraints: ['No pricing redesign', 'No auth redesign'] }), { revision: 2 });
    expect(rev1.ok && rev2.ok).toBe(true);
    if (rev1.ok && rev2.ok) {
      expect(rev1.value.revision).toBe(1);
      expect(rev2.value.revision).toBe(2);
      expect(rev1.value.constraints).toEqual(['No pricing redesign']);
    }
  });

  it('stableDigest is order-independent and reproducible', () => {
    expect(stableDigest({ a: 1, b: [2, 3] })).toBe(stableDigest({ b: [2, 3], a: 1 }));
    expect(stableDigest({ a: 1 })).not.toBe(stableDigest({ a: 2 }));
  });
});

const facts = (over: Partial<ExecutionFacts> = {}): ExecutionFacts => ({
  attestationId: 'att_1', projectId: 'prj_1', missionId: 'msn_1', taskId: 'tsk_1', runId: 'run_1',
  requestedAgentId: 'claude-code-local', requestedAgentType: 'coding-agent', requestedRole: 'coding-agent',
  actualAgentId: 'claude-code-local', actualAgentType: 'coding-agent', actualRole: 'coding-agent',
  adapterId: 'claude-code-local', launchRequested: true, launchVerified: true, completionSignalReceived: true,
  workspaceInspectionCompleted: true, verificationCompleted: true, evidenceIds: ['evd_1'],
  externalSessionId: 'sess-123', outputSummary: 'report', activitySummary: 'edit', provenance: 'live', ...over,
});

describe('execution attestation', () => {
  it('separates requested and actual identity and is immutable + live', () => {
    const a = buildExecutionAttestation(facts());
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.requestedAgentId).toBe('claude-code-local');
      expect(a.value.actualAgentId).toBe('claude-code-local');
      expect(a.value.provenance).toBe('live');
      expect(a.value.immutable).toBe(true);
      expect(Object.isFrozen(a.value)).toBe(true);
      expect(attestsSuccessfulExecution(a.value)).toBe(true);
    }
  });

  it('a launch request without verification is not successful execution proof', () => {
    const a = buildExecutionAttestation(facts({ launchVerified: false }));
    expect(a.ok && attestsSuccessfulExecution(a.value)).toBe(false);
  });

  it('a failed launch and missing session still build but do not prove execution', () => {
    const failed = buildExecutionAttestation(facts({ launchVerified: false, completionSignalReceived: false, externalSessionId: null }));
    expect(failed.ok && attestsSuccessfulExecution(failed.value)).toBe(false);
  });

  it('simulated execution keeps simulated provenance', () => {
    const a = buildExecutionAttestation(facts({ actualAgentId: 'sim-coding-agent', provenance: 'simulated' }));
    expect(a.ok && a.value.provenance).toBe('simulated');
  });

  it('a fallback is disclosed; an unauthorized fallback fails; a fallback cannot inherit the requested identity', () => {
    const disclosed = buildExecutionAttestation(facts({ fallback: { occurred: true, agentId: 'sim-backup', reason: 'primary unavailable', authorized: true } }));
    expect(disclosed.ok && disclosed.value.fallbackOccurred).toBe(true);
    expect(buildExecutionAttestation(facts({ fallback: { occurred: true, agentId: 'sim-backup', reason: 'x', authorized: false } })).ok).toBe(false);
    expect(buildExecutionAttestation(facts({ fallback: { occurred: true, agentId: 'claude-code-local', reason: 'x', authorized: true } })).ok).toBe(false);
  });

  it('digests are stable and carry no credentials/hidden reasoning', () => {
    const a1 = buildExecutionAttestation(facts());
    const a2 = buildExecutionAttestation(facts());
    expect(a1.ok && a2.ok && a1.value.outputDigest === a2.value.outputDigest).toBe(true);
    const serialized = JSON.stringify(a1.ok ? a1.value : {});
    expect(serialized).not.toContain('sess-123' === 'sess-123' ? 'SECRET' : ''); // no secret marker
    expect(serialized.toLowerCase()).not.toContain('token');
  });

  it('hasAttestedExecutionBy forbids a "reviewed by" state without a real attestation', () => {
    const impl = buildExecutionAttestation(facts());
    const list = impl.ok ? [impl.value] : [];
    expect(hasAttestedExecutionBy(list, 'claude-code-local', 'coding-agent')).toBe(true);
    expect(hasAttestedExecutionBy(list, 'sim-reviewer', 'reviewer')).toBe(false);
  });
});

const REVIEW_INPUTS: ReviewInput[] = [
  { attempt: 1, verdict: 'changes_requested', reviewerAgentId: 'sim-reviewer', requestedReviewerAgentId: 'sim-reviewer', independent: true, provenance: 'simulated', findings: [{ id: 'F-1', severity: 'high', title: 'IPv6 /128 bypass', detail: 'rotation', recommendation: 'aggregate /64' }] },
  { attempt: 2, verdict: 'approved', reviewerAgentId: 'sim-reviewer', requestedReviewerAgentId: 'sim-reviewer', independent: true, provenance: 'simulated', findings: [] },
];

const reviewLedger = (over: Partial<Parameters<typeof projectReviewLedger>[0]> = {}) =>
  projectReviewLedger({
    missionId: 'msn_1', taskId: 'tsk_1', reviewerRunId: 'run_1', missionRevision: 1, taskRevision: 0,
    workspaceRevision: 'rev', originalClaimedFiles: ['src/a.ts'], affectedCriterionIds: ['AC-1'],
    reviews: REVIEW_INPUTS,
    postRepairEvidenceIds: ['evd_pass'], repairDispatched: true, maxRepairIterations: 1, now: T0, ...over,
  });

describe('review + repair ledger', () => {
  it('changes_required requires an actionable finding; approved never does', () => {
    expect(reviewHasActionableFinding({ attempt: 1, verdict: 'changes_requested', reviewerAgentId: 'r', requestedReviewerAgentId: 'r', independent: true, provenance: 'simulated', findings: [] })).toBe(false);
    expect(reviewHasActionableFinding({ attempt: 1, verdict: 'approved', reviewerAgentId: 'r', requestedReviewerAgentId: 'r', independent: true, provenance: 'simulated', findings: [] })).toBe(true);
  });

  it('a blocking finding creates one linked repair that preserves the criterion', () => {
    const l = reviewLedger();
    expect(l.findings).toHaveLength(1);
    expect(l.repairs).toHaveLength(1);
    expect(l.repairs[0].findingId).toBe(l.findings[0].findingId);
    expect(l.findings[0].affectedCriterionIds).toEqual(['AC-1']);
    expect(l.repairs[0].prohibitedScopeExpansion).toBe(true);
  });

  it('resolution requires post-repair evidence AND an approving re-review — never a bare claim', () => {
    // Missing re-review approval → not resolved.
    const noReReview = reviewLedger({ reviews: [REVIEW_INPUTS[0]] });
    expect(noReReview.findings[0].status).not.toBe('resolved');
    // Missing evidence → not resolved.
    const noEvidence = reviewLedger({ postRepairEvidenceIds: [] });
    expect(noEvidence.findings[0].status).not.toBe('resolved');
    // Both present → resolved.
    expect(reviewLedger().findings[0].status).toBe('resolved');
  });

  it('a repair cannot expand file claims', () => {
    expect(repairExpandsFileClaims({ affectedFiles: ['src/a.ts'] }, ['src/a.ts'])).toBe(false);
    expect(repairExpandsFileClaims({ affectedFiles: ['src/a.ts', 'src/secret.ts'] }, ['src/a.ts'])).toBe(true);
  });

  it('open blocking findings prevent completion; the repair iteration limit is enforced', () => {
    const unresolved = reviewLedger({ reviews: [REVIEW_INPUTS[0]] });
    expect(openBlockingFindings(unresolved.findings).length).toBe(1);
    // Two blocking findings but max 1 repair → limit exceeded.
    const twoFindings = reviewLedger({
      reviews: [{ attempt: 1, verdict: 'changes_requested', reviewerAgentId: 'sim-reviewer', requestedReviewerAgentId: 'sim-reviewer', independent: true, provenance: 'simulated', findings: [
        { id: 'F-1', severity: 'high', title: 'a', detail: 'd' }, { id: 'F-2', severity: 'high', title: 'b', detail: 'd' },
      ] }],
      maxRepairIterations: 1,
    });
    expect(twoFindings.limitExceeded).toBe(true);
  });
});

const verdictInput = (over: Partial<MissionVerdictInput> = {}): MissionVerdictInput => ({
  completionRule: 'all_blocking_criteria_and_independent_review', runStatus: 'completed',
  implementationReported: true, requiredTestsPassed: true, evidenceSatisfied: true, evidenceReferencesResolve: true,
  requiredTasksVerified: true, reviews: reviewLedger().reviews,
  findings: reviewLedger().findings, requiredReviewApproved: true, requiredAttestationsPresent: true,
  withinRepairAndReviewLimits: true, ...over,
});

describe('deterministic mission verdicts', () => {
  it('verified_complete only when every condition holds', () => {
    expect(evaluateMissionVerdict(verdictInput()).verdict).toBe('verified_complete');
  });

  it('the eight verdicts are distinct and reasons are deterministic', () => {
    expect(evaluateMissionVerdict(verdictInput({ runStatus: 'failed' })).verdict).toBe('failed');
    expect(evaluateMissionVerdict(verdictInput({ runStatus: 'cancelled' })).verdict).toBe('blocked');
    expect(evaluateMissionVerdict(verdictInput({ runStatus: 'checkpoint_required' })).verdict).toBe('needs_human');
    // Approval without passing tests → approved, NEVER verified.
    const approvedNoTests = evaluateMissionVerdict(verdictInput({ requiredTestsPassed: false, evidenceSatisfied: false }));
    expect(approvedNoTests.verdict).toBe('approved');
    expect(approvedNoTests.reasons.length).toBeGreaterThan(0);
    // Missing attestation blocks verified completion.
    expect(evaluateMissionVerdict(verdictInput({ requiredAttestationsPresent: false })).verdict).toBe('approved');
    // Missing review blocks verified completion.
    expect(evaluateMissionVerdict(verdictInput({ requiredReviewApproved: false })).verdict).not.toBe('verified_complete');
    // Open blocking finding → blocked.
    const openFinding = reviewLedger({ reviews: [REVIEW_INPUTS[0]] }).findings;
    expect(evaluateMissionVerdict(verdictInput({ findings: openFinding })).verdict).toBe('blocked');
    // Nothing reviewed yet → claimed_complete.
    expect(evaluateMissionVerdict(verdictInput({ runStatus: 'active', reviews: [], findings: [], requiredReviewApproved: false, requiredAttestationsPresent: false })).verdict).toBe('claimed_complete');
  });

  it('a free-text claim is never evidence', () => {
    const v = evaluateMissionVerdict(verdictInput({ runStatus: 'active', requiredTestsPassed: false, evidenceSatisfied: false, reviews: [], findings: [], requiredReviewApproved: false, requiredAttestationsPresent: false }));
    expect(v.verdict).toBe('claimed_complete');
    expect(v.verdict).not.toBe('verified_complete');
  });
});

describe('mission timeline', () => {
  const events = [
    { sequence: 1, at: T0, source: 'relay-core', kind: 'run.created', provenance: 'simulated' as const, safeSummary: 'run created' },
    { sequence: 2, at: T0, source: 'coding-agent', kind: 'agent.session_started', provenance: 'simulated' as const, safeSummary: 'session started' },
    { sequence: 3, at: T0, source: 'coding-agent', kind: 'agent.report_created', provenance: 'simulated' as const, safeSummary: 'report' },
    { sequence: 4, at: T0, source: 'reviewer', kind: 'reviewer.verdict_created', provenance: 'simulated' as const, safeSummary: 'changes requested' },
    { sequence: 5, at: T0, source: 'coding-agent', kind: 'agent.session_resumed', provenance: 'simulated' as const, safeSummary: 'resumed' },
    { sequence: 6, at: T0, source: 'reviewer', kind: 'reviewer.verdict_created', provenance: 'simulated' as const, safeSummary: 'approved' },
    { sequence: 7, at: T0, source: 'relay-core', kind: 'run.completed', provenance: 'simulated' as const, safeSummary: 'complete' },
  ];
  const ctx = {
    missionRevision: 1, taskRevision: 0, requestedImplementer: 'Claude Code', actualImplementer: 'sim-coding-agent',
    requestedReviewer: 'Codex', actualReviewer: 'sim-reviewer',
    findings: reviewLedger().findings, repairs: reviewLedger().repairs,
  };

  it('is ordered, keeps every input event, and shows requested vs actual + attempts + revisions', () => {
    const tl = buildMissionTimeline(events, ctx);
    expect(tl.map((e) => e.sequence)).toEqual(tl.map((_, i) => i + 1)); // monotonic
    expect(tl.length).toBeGreaterThanOrEqual(events.length); // no silent removal
    const impl = tl.find((e) => e.kind === 'completion_claimed');
    expect(impl?.requestedAgent).toBe('Claude Code');
    expect(impl?.actualAgent).toBe('sim-coding-agent');
    expect(tl.every((e) => e.missionRevision === 1)).toBe(true);
    expect(tl.some((e) => e.attempt === 2)).toBe(true);
    expect(tl.filter((e) => e.kind === 'finding_created')).toHaveLength(1);
    expect(tl.filter((e) => e.kind === 'repair_created')).toHaveLength(1);
    expect(tl.filter((e) => e.kind === 'finding_resolved')).toHaveLength(1);
    expect(() => JSON.stringify(tl)).not.toThrow();
  });

  it('represents a failure path where the reviewer never launched', () => {
    const failEvents = events.slice(0, 3);
    const tl = buildMissionTimeline(failEvents, { ...ctx, findings: [], repairs: [] });
    expect(tl.some((e) => e.kind === 'mission_verified')).toBe(false);
    expect(tl.some((e) => e.kind === 'finding_resolved')).toBe(false);
  });
});
