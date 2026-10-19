import { describe, expect, it } from 'vitest';

import {
  AQUALA_STATUS_VALUES,
  DEFAULT_RELEASE_POLICY,
  applyStatusTransition,
  createInitialAqualaOutcomeStatus,
  deriveReleaseEligibility,
  reconstructStatusFromEvents,
  validateCrossDimensionInvariants,
  validateExecutionTransition,
  validateOutcomeTransition,
  validateReleaseTransition,
  validateVerificationTransition,
} from './status-model';
import type {
  AqualaExecutionStatus,
  AqualaMissionOutcomeStatus,
  AqualaOutcomeStatus,
  AqualaReleaseStatus,
  AqualaStatusDimension,
  AqualaStatusTransitionEvent,
  AqualaStatusTransitionRequest,
  AqualaVerificationStatus,
} from './status-model';

/**
 * MISSION OPERATIONS MILESTONE 1 — status model tests.
 *
 * The expected transition tables below restate the APPROVED SPEC, not the
 * implementation, so a silent table edit in status-model.ts fails here.
 */

/* ------------------------------------------------------- spec tables */

const SPEC_EXECUTION: Record<AqualaExecutionStatus, readonly AqualaExecutionStatus[]> = {
  not_started: ['starting', 'running'],
  starting: ['running', 'failed', 'cancelled'],
  running: ['waiting', 'completed', 'failed', 'cancelled'],
  waiting: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const SPEC_OUTCOME: Record<AqualaMissionOutcomeStatus, readonly AqualaMissionOutcomeStatus[]> = {
  unknown: ['partial', 'satisfied', 'violated'],
  partial: ['satisfied', 'violated'],
  satisfied: ['violated', 'partial'],
  violated: [],
};

const SPEC_VERIFICATION: Record<AqualaVerificationStatus, readonly AqualaVerificationStatus[]> = {
  unverified: ['reviewing'],
  reviewing: ['changes_required', 'approved'],
  changes_required: ['reviewing'],
  approved: ['verified', 'unverified', 'reviewing'],
  verified: ['unverified', 'reviewing'],
};

const SPEC_RELEASE: Record<AqualaReleaseStatus, readonly AqualaReleaseStatus[]> = {
  not_eligible: ['human_approval_required', 'eligible'],
  human_approval_required: ['eligible', 'not_eligible'],
  eligible: ['released', 'not_eligible', 'human_approval_required'],
  released: ['rolled_back'],
  rolled_back: ['not_eligible'],
};

/* --------------------------------------------------------- helpers */

let eventCounter = 0;

function makeRequest(
  overrides: Partial<AqualaStatusTransitionRequest> &
    Pick<AqualaStatusTransitionRequest, 'dimension' | 'nextStatus'>,
): AqualaStatusTransitionRequest {
  eventCounter += 1;
  return {
    reason: 'test transition',
    actorId: 'relay-test',
    actorType: 'system',
    eventId: `evt-${String(eventCounter).padStart(4, '0')}`,
    projectId: 'proj-001',
    missionId: 'mission-001',
    missionRevision: 1,
    occurredAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

function statusWith(overrides: Partial<AqualaOutcomeStatus>): AqualaOutcomeStatus {
  return { ...createInitialAqualaOutcomeStatus(), ...overrides };
}

function freezeStatus(status: AqualaOutcomeStatus): AqualaOutcomeStatus {
  return Object.freeze({ ...status });
}

/** Applies a sequence of (dimension, nextStatus) steps, asserting every step
    is accepted, and returns the final status plus the emitted events. */
function applySequence(
  initial: AqualaOutcomeStatus,
  steps: ReadonlyArray<
    { dimension: AqualaStatusDimension; nextStatus: string } & Partial<AqualaStatusTransitionRequest>
  >,
): { status: AqualaOutcomeStatus; events: AqualaStatusTransitionEvent[] } {
  let status = initial;
  const events: AqualaStatusTransitionEvent[] = [];
  for (const step of steps) {
    const result = applyStatusTransition(status, makeRequest(step));
    expect(result.ok, `step ${step.dimension} → ${step.nextStatus} should be accepted`).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    status = result.status;
    events.push(result.event);
  }
  return { status, events };
}

/** A full canonical mission: run to completion, satisfy the outcome, pass
    independent verification, then release. */
const HAPPY_PATH: ReadonlyArray<{ dimension: AqualaStatusDimension; nextStatus: string }> = [
  { dimension: 'execution', nextStatus: 'starting' },
  { dimension: 'execution', nextStatus: 'running' },
  { dimension: 'outcome', nextStatus: 'partial' },
  { dimension: 'execution', nextStatus: 'completed' },
  { dimension: 'outcome', nextStatus: 'satisfied' },
  { dimension: 'verification', nextStatus: 'reviewing' },
  { dimension: 'verification', nextStatus: 'approved' },
  { dimension: 'verification', nextStatus: 'verified' },
  { dimension: 'release', nextStatus: 'eligible' },
  { dimension: 'release', nextStatus: 'released' },
];

/* ----------------------------------------------------- canonical shape */

describe('canonical status values', () => {
  it('starts every dimension at its canonical initial value', () => {
    expect(createInitialAqualaOutcomeStatus()).toEqual({
      executionStatus: 'not_started',
      outcomeStatus: 'unknown',
      verificationStatus: 'unverified',
      releaseStatus: 'not_eligible',
    });
  });

  it('returns a fresh object per call (no shared mutable initial)', () => {
    const a = createInitialAqualaOutcomeStatus();
    const b = createInitialAqualaOutcomeStatus();
    expect(a).not.toBe(b);
  });

  it('exposes exactly the canonical status vocabulary per dimension', () => {
    expect([...AQUALA_STATUS_VALUES.execution].sort()).toEqual(
      ['not_started', 'starting', 'running', 'waiting', 'completed', 'failed', 'cancelled'].sort(),
    );
    expect([...AQUALA_STATUS_VALUES.outcome].sort()).toEqual(
      ['unknown', 'partial', 'satisfied', 'violated'].sort(),
    );
    expect([...AQUALA_STATUS_VALUES.verification].sort()).toEqual(
      ['unverified', 'reviewing', 'changes_required', 'approved', 'verified'].sort(),
    );
    expect([...AQUALA_STATUS_VALUES.release].sort()).toEqual(
      ['not_eligible', 'human_approval_required', 'eligible', 'released', 'rolled_back'].sort(),
    );
  });

  it('represents the four dimensions together without a collapsed "complete"', () => {
    const status = createInitialAqualaOutcomeStatus();
    expect(Object.keys(status).sort()).toEqual(
      ['executionStatus', 'outcomeStatus', 'releaseStatus', 'verificationStatus'].sort(),
    );
    // Execution finishing alone moves NOTHING else: completed work is not a
    // satisfied outcome, not a verification, not a release.
    const { status: ran } = applySequence(status, [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
    ]);
    expect(ran).toEqual({
      executionStatus: 'completed',
      outcomeStatus: 'unknown',
      verificationStatus: 'unverified',
      releaseStatus: 'not_eligible',
    });
  });
});

/* ---------------------------------------- exhaustive transition tables */

interface DimensionCase<T extends string> {
  dimension: AqualaStatusDimension;
  spec: Record<string, readonly string[]>;
  states: readonly T[];
  validate: (previous: T, next: T) => { ok: boolean; reason: string };
  invalidCode: string;
  place: (status: AqualaOutcomeStatus, value: T) => AqualaOutcomeStatus;
}

const DIMENSION_CASES: ReadonlyArray<DimensionCase<string>> = [
  {
    dimension: 'execution',
    spec: SPEC_EXECUTION,
    states: AQUALA_STATUS_VALUES.execution,
    validate: (p, n) =>
      validateExecutionTransition(p as AqualaExecutionStatus, n as AqualaExecutionStatus),
    invalidCode: 'INVALID_EXECUTION_TRANSITION',
    place: (s, v) => ({ ...s, executionStatus: v as AqualaExecutionStatus }),
  },
  {
    dimension: 'outcome',
    spec: SPEC_OUTCOME,
    states: AQUALA_STATUS_VALUES.outcome,
    validate: (p, n) =>
      validateOutcomeTransition(p as AqualaMissionOutcomeStatus, n as AqualaMissionOutcomeStatus),
    invalidCode: 'INVALID_OUTCOME_TRANSITION',
    place: (s, v) => ({ ...s, outcomeStatus: v as AqualaMissionOutcomeStatus }),
  },
  {
    dimension: 'verification',
    spec: SPEC_VERIFICATION,
    states: AQUALA_STATUS_VALUES.verification,
    validate: (p, n) =>
      validateVerificationTransition(p as AqualaVerificationStatus, n as AqualaVerificationStatus),
    invalidCode: 'INVALID_VERIFICATION_TRANSITION',
    place: (s, v) => ({ ...s, verificationStatus: v as AqualaVerificationStatus }),
  },
  {
    dimension: 'release',
    spec: SPEC_RELEASE,
    states: AQUALA_STATUS_VALUES.release,
    validate: (p, n) =>
      validateReleaseTransition(p as AqualaReleaseStatus, n as AqualaReleaseStatus),
    invalidCode: 'INVALID_RELEASE_TRANSITION',
    place: (s, v) => ({ ...s, releaseStatus: v as AqualaReleaseStatus }),
  },
];

describe.each(DIMENSION_CASES)('$dimension transition table', ({ spec, states, validate }) => {
  it('accepts exactly the spec-approved pairs and rejects every other pair', () => {
    for (const previous of states) {
      for (const next of states) {
        const expected = previous !== next && spec[previous].includes(next);
        const verdict = validate(previous, next);
        expect(
          verdict.ok,
          `${previous} → ${next} should be ${expected ? 'valid' : 'invalid'} (${verdict.reason})`,
        ).toBe(expected);
      }
    }
  });

  it('rejects no-op transitions for every state', () => {
    for (const state of states) {
      expect(validate(state, state).ok).toBe(false);
    }
  });
});

describe('terminal states', () => {
  it('never allows a terminal execution state to silently resume', () => {
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      for (const next of AQUALA_STATUS_VALUES.execution) {
        expect(validateExecutionTransition(terminal, next).ok).toBe(false);
      }
    }
  });

  it('never allows a violated outcome to recover', () => {
    for (const next of AQUALA_STATUS_VALUES.outcome) {
      expect(validateOutcomeTransition('violated', next).ok).toBe(false);
    }
  });

  it('never allows rolled_back → released without a fresh eligibility pass', () => {
    expect(validateReleaseTransition('rolled_back', 'released').ok).toBe(false);
    expect(validateReleaseTransition('rolled_back', 'eligible').ok).toBe(false);
    expect(validateReleaseTransition('rolled_back', 'not_eligible').ok).toBe(true);
  });
});

/* -------------------------------------------- applyStatusTransition */

describe('applyStatusTransition', () => {
  it('accepts a valid transition and returns the next status plus one typed event', () => {
    const initial = freezeStatus(createInitialAqualaOutcomeStatus());
    const request = makeRequest({
      dimension: 'execution',
      nextStatus: 'starting',
      taskId: 'task-01',
      missionRevision: 3,
      reason: 'agent dispatch requested',
      actorId: 'relay-core',
      actorType: 'relay',
    });
    const result = applyStatusTransition(initial, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.executionStatus).toBe('starting');
    expect(result.event).toEqual({
      eventId: request.eventId,
      projectId: 'proj-001',
      missionId: 'mission-001',
      taskId: 'task-01',
      dimension: 'execution',
      previousStatus: 'not_started',
      nextStatus: 'starting',
      reason: 'agent dispatch requested',
      actorId: 'relay-core',
      actorType: 'relay',
      missionRevision: 3,
      artifactRevision: undefined,
      occurredAt: '2026-07-28T00:00:00.000Z',
    });
  });

  it('never mutates the input status object', () => {
    const initial = freezeStatus(createInitialAqualaOutcomeStatus());
    const result = applyStatusTransition(
      initial,
      makeRequest({ dimension: 'execution', nextStatus: 'running' }),
    );
    expect(result.ok).toBe(true);
    expect(initial.executionStatus).toBe('not_started');
    if (result.ok) expect(result.status).not.toBe(initial);
  });

  it('rejects an invalid transition and preserves the previous state byte-for-byte', () => {
    const current = freezeStatus(statusWith({ executionStatus: 'completed' }));
    const result = applyStatusTransition(
      current,
      makeRequest({ dimension: 'execution', nextStatus: 'running' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(current);
    expect(result.error.code).toBe('INVALID_EXECUTION_TRANSITION');
    expect(result.error.dimension).toBe('execution');
    expect(result.error.previousStatus).toBe('completed');
    expect(result.error.requestedStatus).toBe('running');
  });

  it.each(DIMENSION_CASES)(
    'rejects every invalid $dimension pair through the full apply path',
    ({ dimension, spec, states, place, invalidCode }) => {
      for (const previous of states) {
        for (const next of states) {
          if (previous !== next && spec[previous].includes(next)) continue;
          const current = freezeStatus(place(createInitialAqualaOutcomeStatus(), previous));
          const result = applyStatusTransition(current, makeRequest({ dimension, nextStatus: next }));
          expect(result.ok, `${dimension} ${previous} → ${next} must be rejected`).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(current);
            expect(result.error.code).toBe(invalidCode);
          }
        }
      }
    },
  );

  it('rejects an unknown dimension with UNKNOWN_STATUS instead of crashing', () => {
    const current = freezeStatus(createInitialAqualaOutcomeStatus());
    const result = applyStatusTransition(
      current,
      makeRequest({ dimension: 'budget' as AqualaStatusDimension, nextStatus: 'running' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_STATUS');
      expect(result.status).toBe(current);
    }
  });

  it('returns a frozen (immutable) event on every accepted transition', () => {
    const result = applyStatusTransition(
      createInitialAqualaOutcomeStatus(),
      makeRequest({ dimension: 'execution', nextStatus: 'starting' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.event)).toBe(true);
      expect(() => {
        (result.event as { nextStatus: string }).nextStatus = 'tampered';
      }).toThrow();
    }
  });

  it('rejects an unknown status value with UNKNOWN_STATUS', () => {
    const current = freezeStatus(createInitialAqualaOutcomeStatus());
    for (const dimension of ['execution', 'outcome', 'verification', 'release'] as const) {
      const result = applyStatusTransition(
        current,
        makeRequest({ dimension, nextStatus: 'definitely_not_a_status' }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN_STATUS');
        expect(result.status).toBe(current);
      }
    }
  });

  it('rejects a stale artifact review at apply time', () => {
    const current = freezeStatus(
      statusWith({ executionStatus: 'completed', verificationStatus: 'reviewing' }),
    );
    const result = applyStatusTransition(
      current,
      makeRequest({
        dimension: 'verification',
        nextStatus: 'approved',
        artifactRevision: 'artifact-rev-1',
        currentArtifactRevision: 'artifact-rev-2',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STALE_ARTIFACT_REVIEW');
    expect(result.status).toBe(current);
  });

  it('accepts an approval that references the current artifact revision', () => {
    const current = statusWith({ executionStatus: 'completed', verificationStatus: 'reviewing' });
    const result = applyStatusTransition(
      current,
      makeRequest({
        dimension: 'verification',
        nextStatus: 'approved',
        artifactRevision: 'artifact-rev-2',
        currentArtifactRevision: 'artifact-rev-2',
      }),
    );
    expect(result.ok).toBe(true);
  });
});

/* -------------------------------------------- cross-dimension invariants */

describe('cross-dimension invariants', () => {
  it('forces release withdrawal before a review can demand changes', () => {
    // Reach: verified, release awaiting human approval, re-review under way.
    const { status: rereviewing } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      { dimension: 'verification', nextStatus: 'approved' },
      { dimension: 'verification', nextStatus: 'verified' },
      { dimension: 'release', nextStatus: 'human_approval_required' },
      { dimension: 'verification', nextStatus: 'reviewing' },
    ]);
    const frozen = freezeStatus(rereviewing);
    const blocked = applyStatusTransition(
      frozen,
      makeRequest({ dimension: 'verification', nextStatus: 'changes_required' }),
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('CROSS_DIMENSION_INVARIANT_VIOLATION');
    expect(blocked.status).toBe(frozen);

    // Withdrawing the pending release grant first makes the decision legal.
    const { status: withdrawn } = applySequence(frozen, [
      { dimension: 'release', nextStatus: 'not_eligible' },
      { dimension: 'verification', nextStatus: 'changes_required' },
    ]);
    expect(withdrawn.verificationStatus).toBe('changes_required');
    expect(withdrawn.releaseStatus).toBe('not_eligible');
  });

  it('requires eligibility withdrawal before verification can be reopened', () => {
    // While release stands at eligible, the combined status must keep its
    // gates met — a re-review (verified → reviewing) is rejected until the
    // eligible grant is withdrawn.
    const { status: eligible } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      { dimension: 'verification', nextStatus: 'approved' },
      { dimension: 'verification', nextStatus: 'verified' },
      { dimension: 'release', nextStatus: 'eligible' },
    ]);
    const frozen = freezeStatus(eligible);
    const reopened = applyStatusTransition(
      frozen,
      makeRequest({ dimension: 'verification', nextStatus: 'reviewing' }),
    );
    expect(reopened.ok).toBe(false);
    if (!reopened.ok) {
      expect(reopened.error.code).toBe('RELEASE_NOT_ELIGIBLE');
      expect(reopened.status).toBe(frozen);
    }
    const { status: after } = applySequence(frozen, [
      { dimension: 'release', nextStatus: 'not_eligible' },
      { dimension: 'verification', nextStatus: 'reviewing' },
    ]);
    expect(after.verificationStatus).toBe('reviewing');
  });

  it('forces release to not_eligible when the outcome becomes violated', () => {
    const { status } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      { dimension: 'verification', nextStatus: 'approved' },
      { dimension: 'verification', nextStatus: 'verified' },
      { dimension: 'release', nextStatus: 'eligible' },
    ]);
    const frozen = freezeStatus(status);
    const violated = applyStatusTransition(
      frozen,
      makeRequest({ dimension: 'outcome', nextStatus: 'violated' }),
    );
    expect(violated.ok).toBe(false);
    if (!violated.ok) {
      expect(violated.error.code).toBe('CROSS_DIMENSION_INVARIANT_VIOLATION');
      expect(violated.status).toBe(frozen);
    }
  });

  it('permits outcome violation to be recorded against an already rolled-back release', () => {
    const { status } = applySequence(createInitialAqualaOutcomeStatus(), [
      ...HAPPY_PATH,
      { dimension: 'release', nextStatus: 'rolled_back' },
    ]);
    const result = applyStatusTransition(
      status,
      makeRequest({ dimension: 'outcome', nextStatus: 'violated' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects release eligibility before the outcome is satisfied', () => {
    const current = freezeStatus(
      statusWith({ executionStatus: 'completed', verificationStatus: 'verified' }),
    );
    const result = applyStatusTransition(
      current,
      makeRequest({ dimension: 'release', nextStatus: 'eligible' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RELEASE_NOT_ELIGIBLE');
      expect(result.error.reason).toContain('outcome');
    }
  });

  it('rejects release eligibility before verification is verified', () => {
    const current = freezeStatus(
      statusWith({ executionStatus: 'completed', outcomeStatus: 'satisfied' }),
    );
    const result = applyStatusTransition(
      current,
      makeRequest({ dimension: 'release', nextStatus: 'eligible' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RELEASE_NOT_ELIGIBLE');
  });

  it('honours a relaxed policy that does not require verified verification', () => {
    const current = statusWith({ executionStatus: 'completed', outcomeStatus: 'satisfied' });
    const result = applyStatusTransition(
      current,
      makeRequest({
        dimension: 'release',
        nextStatus: 'eligible',
        policy: {
          requireOutcomeSatisfied: true,
          requireVerificationVerified: false,
          requireHumanApproval: false,
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('even a fully relaxed policy cannot release past changes_required or violated', () => {
    const relaxed = {
      requireOutcomeSatisfied: false,
      requireVerificationVerified: false,
      requireHumanApproval: false,
    };
    const blockedReview = statusWith({ verificationStatus: 'changes_required' });
    expect(deriveReleaseEligibility(blockedReview, relaxed).gatesMet).toBe(false);
    const violated = statusWith({ outcomeStatus: 'violated' });
    expect(deriveReleaseEligibility(violated, relaxed).gatesMet).toBe(false);
  });

  it('requires the eligible state immediately before releasing', () => {
    // human_approval_required has gates met, but released may only follow
    // eligible — approval must be granted (→ eligible) first.
    const { status } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      { dimension: 'verification', nextStatus: 'approved' },
      { dimension: 'verification', nextStatus: 'verified' },
      { dimension: 'release', nextStatus: 'human_approval_required' },
    ]);
    const result = applyStatusTransition(
      status,
      makeRequest({ dimension: 'release', nextStatus: 'released' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_RELEASE_TRANSITION');
  });

  it('records execution and outcome facts AFTER release without wedging', () => {
    // A mission can be released while execution still runs (eligibility
    // gates on outcome + verification only). The standing released status
    // must never block later truthful facts — rollback is for reversal,
    // not bookkeeping.
    const { status: released } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      { dimension: 'verification', nextStatus: 'approved' },
      { dimension: 'verification', nextStatus: 'verified' },
      { dimension: 'release', nextStatus: 'eligible' },
      { dimension: 'release', nextStatus: 'released' },
    ]);
    expect(released.executionStatus).toBe('running');
    expect(released.releaseStatus).toBe('released');

    // The terminal execution fact is recordable post-release…
    const { status: done } = applySequence(released, [
      { dimension: 'execution', nextStatus: 'completed' },
    ]);
    expect(done).toEqual({ ...released, executionStatus: 'completed' });

    // …and so is later outcome evidence (satisfied → partial is legal).
    const { status: degraded } = applySequence(done, [
      { dimension: 'outcome', nextStatus: 'partial' },
    ]);
    expect(degraded.outcomeStatus).toBe('partial');
    expect(degraded.releaseStatus).toBe('released');
  });

  it('still requires gates and prior eligibility when actually transitioning into released', () => {
    const { status: eligible } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      { dimension: 'verification', nextStatus: 'approved' },
      { dimension: 'verification', nextStatus: 'verified' },
      { dimension: 'release', nextStatus: 'eligible' },
    ]);
    const result = applyStatusTransition(
      eligible,
      makeRequest({ dimension: 'release', nextStatus: 'released' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects requesting human approval before the release gates are met', () => {
    const early = freezeStatus(createInitialAqualaOutcomeStatus());
    const result = applyStatusTransition(
      early,
      makeRequest({ dimension: 'release', nextStatus: 'human_approval_required' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RELEASE_NOT_ELIGIBLE');
      expect(result.error.reason).toContain('human approval');
      expect(result.status).toBe(early);
    }
  });

  it('binds the staleness check to verification decisions only', () => {
    // Approval stamped against the current revision…
    const { status: verified } = applySequence(createInitialAqualaOutcomeStatus(), [
      { dimension: 'execution', nextStatus: 'running' },
      { dimension: 'execution', nextStatus: 'completed' },
      { dimension: 'outcome', nextStatus: 'satisfied' },
      { dimension: 'verification', nextStatus: 'reviewing' },
      {
        dimension: 'verification',
        nextStatus: 'approved',
        artifactRevision: 'artifact-rev-2',
        currentArtifactRevision: 'artifact-rev-2',
      },
      {
        dimension: 'verification',
        nextStatus: 'verified',
        artifactRevision: 'artifact-rev-2',
        currentArtifactRevision: 'artifact-rev-2',
      },
    ]);
    // …must not make an unrelated RELEASE transition (which carries no
    // artifactRevision of its own) fail as a stale review.
    const result = applyStatusTransition(
      verified,
      makeRequest({
        dimension: 'release',
        nextStatus: 'eligible',
        currentArtifactRevision: 'artifact-rev-2',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('completes the canonical happy path end to end', () => {
    const { status, events } = applySequence(createInitialAqualaOutcomeStatus(), HAPPY_PATH);
    expect(status).toEqual({
      executionStatus: 'completed',
      outcomeStatus: 'satisfied',
      verificationStatus: 'verified',
      releaseStatus: 'released',
    });
    expect(events).toHaveLength(HAPPY_PATH.length);
  });
});

/* ------------------------------------------------ release eligibility */

describe('deriveReleaseEligibility', () => {
  it('reports every unmet gate with a concise reason', () => {
    const eligibility = deriveReleaseEligibility(createInitialAqualaOutcomeStatus());
    expect(eligibility.gatesMet).toBe(false);
    expect(eligibility.humanApprovalRequired).toBe(false);
    expect(eligibility.unmet).toEqual([
      'outcome is not satisfied',
      'verification is not verified',
    ]);
  });

  it('requires human approval when gates are met under the default policy', () => {
    const status = statusWith({
      executionStatus: 'completed',
      outcomeStatus: 'satisfied',
      verificationStatus: 'verified',
    });
    const eligibility = deriveReleaseEligibility(status);
    expect(eligibility.gatesMet).toBe(true);
    expect(eligibility.humanApprovalRequired).toBe(true);
    expect(eligibility.unmet).toEqual([]);
  });

  it('drops the human-approval requirement only when the policy says so', () => {
    const status = statusWith({
      executionStatus: 'completed',
      outcomeStatus: 'satisfied',
      verificationStatus: 'verified',
    });
    const eligibility = deriveReleaseEligibility(status, {
      ...DEFAULT_RELEASE_POLICY,
      requireHumanApproval: false,
    });
    expect(eligibility.gatesMet).toBe(true);
    expect(eligibility.humanApprovalRequired).toBe(false);
  });

  it('never mutates the status it inspects', () => {
    const status = freezeStatus(createInitialAqualaOutcomeStatus());
    expect(() => deriveReleaseEligibility(status)).not.toThrow();
  });
});

/* --------------------------------------------------- reconstruction */

describe('reconstructStatusFromEvents', () => {
  function happyPathEvents(): AqualaStatusTransitionEvent[] {
    return applySequence(createInitialAqualaOutcomeStatus(), HAPPY_PATH).events;
  }

  it('deterministically folds an ordered event stream to the exact final status', () => {
    const events = happyPathEvents();
    const first = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    const second = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    expect(first.ok).toBe(true);
    expect(first).toEqual(second);
    if (first.ok) {
      expect(first.status).toEqual({
        executionStatus: 'completed',
        outcomeStatus: 'satisfied',
        verificationStatus: 'verified',
        releaseStatus: 'released',
      });
    }
  });

  it('reconstruction matches live application for every prefix of the stream', () => {
    const events = happyPathEvents();
    let live = createInitialAqualaOutcomeStatus();
    for (let i = 0; i < events.length; i += 1) {
      const replayed = reconstructStatusFromEvents(
        createInitialAqualaOutcomeStatus(),
        events.slice(0, i + 1),
      );
      const e = events[i];
      const applied = applyStatusTransition(
        live,
        makeRequest({
          dimension: e.dimension,
          nextStatus: e.nextStatus,
          missionRevision: e.missionRevision,
          artifactRevision: e.artifactRevision,
        }),
      );
      expect(applied.ok).toBe(true);
      if (applied.ok) live = applied.status;
      expect(replayed.ok).toBe(true);
      if (replayed.ok) expect(replayed.status).toEqual(live);
    }
  });

  it('never mutates the input events array or the initial status', () => {
    const events = happyPathEvents();
    const snapshot = JSON.parse(JSON.stringify(events)) as AqualaStatusTransitionEvent[];
    const initial = freezeStatus(createInitialAqualaOutcomeStatus());
    Object.freeze(events);
    const result = reconstructStatusFromEvents(initial, events);
    expect(result.ok).toBe(true);
    expect(events).toEqual(snapshot);
    expect(initial.executionStatus).toBe('not_started');
  });

  it('fails at the exact index of an event whose previousStatus does not match', () => {
    const events = happyPathEvents();
    events[3] = { ...events[3], previousStatus: 'waiting' };
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedIndex).toBe(3);
    expect(result.error.code).toBe('REVISION_MISMATCH');
    // The reconstructed status stops at the last valid event.
    expect(result.status.executionStatus).toBe('running');
  });

  it('rejects a backward mission revision', () => {
    const events = happyPathEvents().map((event, index) => ({
      ...event,
      missionRevision: index < 2 ? 5 : 4,
    }));
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedIndex).toBe(2);
    expect(result.error.code).toBe('REVISION_MISMATCH');
    expect(result.error.reason).toContain('backward');
  });

  it('rejects an illegal transition inside the stream at its exact index', () => {
    const events = happyPathEvents();
    // Forge event 4 to claim completed → running (illegal, terminal state).
    events[4] = {
      ...events[4],
      dimension: 'execution',
      previousStatus: 'completed',
      nextStatus: 'running',
    };
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedIndex).toBe(4);
    expect(result.error.code).toBe('INVALID_EXECUTION_TRANSITION');
  });

  it('rejects an unknown status inside the stream', () => {
    const events = happyPathEvents();
    events[1] = { ...events[1], nextStatus: 'sideways' };
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedIndex).toBe(1);
      expect(result.error.code).toBe('UNKNOWN_STATUS');
    }
  });

  it('rejects an approval recorded against a stale artifact revision', () => {
    const events = happyPathEvents().map(event =>
      event.dimension === 'verification'
        ? { ...event, artifactRevision: 'artifact-rev-1' }
        : event,
    );
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events, {
      currentArtifactRevision: 'artifact-rev-2',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STALE_ARTIFACT_REVIEW');
    // Fails on the approval event (index 6), not the reviewing event.
    expect(result.failedIndex).toBe(6);
  });

  it('accepts the same stream when the reviewed revision IS current', () => {
    // Only the verification DECISIONS carry the artifact revision; the
    // staleness check must not demand it from execution/outcome/release
    // events that follow a standing approval.
    const events = happyPathEvents().map(event =>
      event.dimension === 'verification'
        ? { ...event, artifactRevision: 'artifact-rev-2' }
        : event,
    );
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events, {
      currentArtifactRevision: 'artifact-rev-2',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an event with an unknown dimension structurally, never with a crash', () => {
    const events = happyPathEvents();
    // previousStatus matches the release fallback so the event reaches the
    // dimension switch itself — a forged/corrupted persisted event.
    events[2] = {
      ...events[2],
      dimension: 'budget' as AqualaStatusDimension,
      previousStatus: 'not_eligible',
    };
    const result = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedIndex).toBe(2);
      expect(result.error.code).toBe('UNKNOWN_STATUS');
    }
  });

  it('reconstructs an empty stream to the initial status', () => {
    const initial = statusWith({ executionStatus: 'running' });
    const result = reconstructStatusFromEvents(initial, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toEqual(initial);
      expect(result.status).not.toBe(initial);
    }
  });
});

/* ------------------------------------------- invariant validator directly */

describe('validateCrossDimensionInvariants', () => {
  it('returns null for a coherent proposal', () => {
    expect(
      validateCrossDimensionInvariants(
        createInitialAqualaOutcomeStatus(),
        statusWith({ executionStatus: 'running' }),
      ),
    ).toBeNull();
  });

  it('flags a stale review through explicit context', () => {
    const current = statusWith({ verificationStatus: 'reviewing' });
    const proposed = statusWith({ verificationStatus: 'approved' });
    const error = validateCrossDimensionInvariants(current, proposed, {
      reviewedArtifactRevision: 'artifact-rev-1',
      currentArtifactRevision: 'artifact-rev-2',
    });
    expect(error?.code).toBe('STALE_ARTIFACT_REVIEW');
  });

  it('does not flag staleness when the mission has no artifact revision tracking', () => {
    const current = statusWith({ verificationStatus: 'reviewing' });
    const proposed = statusWith({ verificationStatus: 'approved' });
    expect(validateCrossDimensionInvariants(current, proposed, {})).toBeNull();
  });
});
