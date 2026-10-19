import { describe, expect, it } from 'vitest';

import {
  adaptCodingTerminalStatus,
  adaptMissionReviewVerdict,
  adaptMissionStatus,
  adaptMissionVerdict,
  adaptRelayMissionState,
  legacyMissionStatusTransitionPlan,
  legacyStatusTransitionPlan,
  materializeLegacyStatusEvents,
} from './legacy-compat';
import {
  createInitialAqualaOutcomeStatus,
  reconstructStatusFromEvents,
} from './status-model';
import type { AqualaOutcomeStatus, AqualaReleasePolicy } from './status-model';
import type { MissionStatus, MissionVerdict } from '../contracts';
import type { CodingTerminalStatus, MissionReview, RelayMissionState } from '../wire-contracts';

/**
 * Compatibility adapter tests. The core property: every legacy state maps to
 * a four-dimension status that is REACHABLE through the real transition
 * engine, and the materialized events reconstruct to exactly that status.
 */

const NO_APPROVAL_POLICY: AqualaReleasePolicy = {
  requireOutcomeSatisfied: true,
  requireVerificationVerified: true,
  requireHumanApproval: false,
};

/* -------------------------------------------- browser-app mission state */

const EXPECTED_MISSION_STATE: Record<RelayMissionState, AqualaOutcomeStatus> = {
  configured: {
    executionStatus: 'not_started',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  ready: {
    executionStatus: 'not_started',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  architect_working: {
    executionStatus: 'running',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  handoff_ready: {
    executionStatus: 'waiting',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  coding: {
    executionStatus: 'running',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  claim_submitted: {
    executionStatus: 'waiting',
    outcomeStatus: 'unknown', // a claim is NOT a satisfied outcome
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  relay_verifying: {
    executionStatus: 'waiting',
    outcomeStatus: 'unknown',
    verificationStatus: 'reviewing',
    releaseStatus: 'not_eligible',
  },
  reviewer_reviewing: {
    executionStatus: 'waiting',
    outcomeStatus: 'unknown',
    verificationStatus: 'reviewing',
    releaseStatus: 'not_eligible',
  },
  repair_required: {
    executionStatus: 'waiting',
    outcomeStatus: 'partial',
    verificationStatus: 'changes_required',
    releaseStatus: 'not_eligible',
  },
  repair_in_progress: {
    executionStatus: 'running',
    outcomeStatus: 'partial',
    verificationStatus: 'changes_required',
    releaseStatus: 'not_eligible',
  },
  re_verifying: {
    executionStatus: 'waiting',
    outcomeStatus: 'partial',
    verificationStatus: 'reviewing',
    releaseStatus: 'not_eligible',
  },
  approved: {
    executionStatus: 'completed',
    outcomeStatus: 'partial', // reviewer approval alone ≠ confirmed outcome
    verificationStatus: 'approved',
    releaseStatus: 'not_eligible',
  },
  verified_complete: {
    executionStatus: 'completed',
    outcomeStatus: 'satisfied',
    verificationStatus: 'verified',
    releaseStatus: 'human_approval_required', // default policy: founder approves
  },
  failed: {
    executionStatus: 'failed',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  cancelled: {
    executionStatus: 'cancelled',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
};

const ALL_MISSION_STATES = Object.keys(EXPECTED_MISSION_STATE) as RelayMissionState[];

describe('adaptRelayMissionState', () => {
  it.each(ALL_MISSION_STATES)('maps legacy "%s" to its four-dimension status', state => {
    expect(adaptRelayMissionState(state)).toEqual(EXPECTED_MISSION_STATE[state]);
  });

  it('is deterministic', () => {
    for (const state of ALL_MISSION_STATES) {
      expect(adaptRelayMissionState(state)).toEqual(adaptRelayMissionState(state));
    }
  });

  it('never fabricates a released or rolled_back state from legacy data', () => {
    for (const state of ALL_MISSION_STATES) {
      const adapted = adaptRelayMissionState(state);
      expect(adapted.releaseStatus).not.toBe('released');
      expect(adapted.releaseStatus).not.toBe('rolled_back');
    }
  });

  it('derives the release tail from the policy, not a hardcoded value', () => {
    expect(adaptRelayMissionState('verified_complete', NO_APPROVAL_POLICY).releaseStatus).toBe(
      'eligible',
    );
    expect(adaptRelayMissionState('verified_complete').releaseStatus).toBe(
      'human_approval_required',
    );
  });
});

describe('materializeLegacyStatusEvents', () => {
  it.each(ALL_MISSION_STATES)(
    'produces a reachable, reconstructable event history for "%s"',
    state => {
      const result = materializeLegacyStatusEvents({
        state,
        projectId: 'proj-legacy',
        missionId: 'mission-legacy',
        eventIdPrefix: 'mission-legacy',
        occurredAt: '2026-07-28T00:00:00.000Z',
      });
      expect(result.ok, `plan for "${state}" must replay cleanly`).toBe(true);
      if (!result.ok) return;
      expect(result.status).toEqual(EXPECTED_MISSION_STATE[state]);

      // The events are a legitimate history: the real reconstruction engine
      // folds them back to exactly the adapted status.
      const replayed = reconstructStatusFromEvents(createInitialAqualaOutcomeStatus(), result.events);
      expect(replayed.ok).toBe(true);
      if (replayed.ok) expect(replayed.status).toEqual(result.status);
    },
  );

  it('stamps deterministic ordered event ids and the compat actor', () => {
    const result = materializeLegacyStatusEvents({
      state: 'approved',
      projectId: 'proj-legacy',
      missionId: 'mission-legacy',
      eventIdPrefix: 'm-42',
      occurredAt: '2026-07-28T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Concrete expected ids — never derived from the actual array, so a
    // truncated or empty event list fails here.
    expect(result.events.map(e => e.eventId)).toEqual([
      'm-42-compat-001',
      'm-42-compat-002',
      'm-42-compat-003',
      'm-42-compat-004',
      'm-42-compat-005',
      'm-42-compat-006',
    ]);
    for (const event of result.events) {
      expect(event.actorId).toBe('relay-legacy-compat');
      expect(event.actorType).toBe('system');
      expect(event.projectId).toBe('proj-legacy');
      expect(event.missionId).toBe('mission-legacy');
      expect(event.occurredAt).toBe('2026-07-28T00:00:00.000Z');
      expect(event.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns no events for states that ARE the initial status', () => {
    for (const state of ['configured', 'ready'] as const) {
      const result = materializeLegacyStatusEvents({
        state,
        projectId: 'p',
        missionId: 'm',
        eventIdPrefix: 'm',
        occurredAt: '2026-07-28T00:00:00.000Z',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.events).toEqual([]);
        expect(result.status).toEqual(createInitialAqualaOutcomeStatus());
      }
    }
  });

  it('plans state what the legacy record asserted, never a release the legacy app never made', () => {
    for (const state of ALL_MISSION_STATES) {
      const plan = legacyStatusTransitionPlan(state);
      expect(plan.every(step => step.nextStatus !== 'released')).toBe(true);
    }
  });
});

/* ---------------------------------------- mission-layer contract status */

const EXPECTED_MISSION_STATUS: Record<MissionStatus, AqualaOutcomeStatus> = {
  draft: EXPECTED_MISSION_STATE.configured,
  locked: EXPECTED_MISSION_STATE.configured,
  in_progress: EXPECTED_MISSION_STATE.coding,
  blocked: {
    executionStatus: 'waiting',
    outcomeStatus: 'unknown',
    verificationStatus: 'unverified',
    releaseStatus: 'not_eligible',
  },
  verified_complete: EXPECTED_MISSION_STATE.verified_complete,
  cancelled: EXPECTED_MISSION_STATE.cancelled,
};

describe('adaptMissionStatus', () => {
  it.each(Object.keys(EXPECTED_MISSION_STATUS) as MissionStatus[])(
    'maps mission-layer "%s" to its four-dimension status',
    status => {
      expect(adaptMissionStatus(status)).toEqual(EXPECTED_MISSION_STATUS[status]);
    },
  );

  it('shares the policy-derived release tail with the browser adapter', () => {
    expect(adaptMissionStatus('verified_complete', NO_APPROVAL_POLICY).releaseStatus).toBe(
      'eligible',
    );
    expect(legacyMissionStatusTransitionPlan('verified_complete')).toEqual(
      legacyStatusTransitionPlan('verified_complete'),
    );
  });
});

/* -------------------------------------------------- verdict adapters */

describe('adaptMissionVerdict', () => {
  const CASES: Array<[MissionVerdict, ReturnType<typeof adaptMissionVerdict>]> = [
    // A claim establishes nothing — no dimension assertions at all.
    ['claimed_complete', { humanActionRequired: false }],
    // 'reviewed' = reviews exist and none approved → every completed review
    // demanded changes.
    ['reviewed', { verificationStatus: 'changes_required', humanActionRequired: false }],
    ['approved', { outcomeStatus: 'partial', verificationStatus: 'approved', humanActionRequired: false }],
    ['verified_complete', { outcomeStatus: 'satisfied', verificationStatus: 'verified', humanActionRequired: false }],
    // Producer fall-through "work is in progress" — no outcome evidence.
    ['partially_complete', { humanActionRequired: false }],
    // A run failure is an execution fact; requirements were never evaluated.
    ['failed', { humanActionRequired: false }],
    // Mixed producer causes (cancelled / open findings / limits) — some are
    // resolved by the automated repair path, so no human claim is made.
    ['blocked', { humanActionRequired: false }],
    ['needs_human', { humanActionRequired: true }],
  ];

  it.each(CASES)('verdict "%s" asserts exactly %j', (verdict, expected) => {
    expect(adaptMissionVerdict(verdict)).toEqual(expected);
  });

  it('never asserts execution or release dimensions', () => {
    for (const [verdict] of CASES) {
      const assertion = adaptMissionVerdict(verdict) as unknown as Record<string, unknown>;
      expect(assertion.executionStatus).toBeUndefined();
      expect(assertion.releaseStatus).toBeUndefined();
    }
  });

  it('a claim alone never advances outcome or verification', () => {
    const assertion = adaptMissionVerdict('claimed_complete');
    expect(assertion.outcomeStatus).toBeUndefined();
    expect(assertion.verificationStatus).toBeUndefined();
  });

  it('never fabricates a violated outcome from a pure run failure', () => {
    expect(adaptMissionVerdict('failed').outcomeStatus).toBeUndefined();
  });
});

describe('adaptCodingTerminalStatus', () => {
  const CASES: Array<[CodingTerminalStatus, string]> = [
    ['waiting', 'starting'],
    ['live', 'running'],
    ['complete', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ];
  it.each(CASES)('terminal "%s" → execution "%s"', (terminal, execution) => {
    expect(adaptCodingTerminalStatus(terminal)).toBe(execution);
  });
});

describe('adaptMissionReviewVerdict', () => {
  const CASES: Array<[MissionReview['verdict'], string]> = [
    ['approved', 'approved'],
    ['changes_required', 'changes_required'],
    ['unable_to_review', 'unverified'], // an unfinished review is not a review
  ];
  it.each(CASES)('review verdict "%s" → verification "%s"', (verdict, verification) => {
    expect(adaptMissionReviewVerdict(verdict)).toBe(verification);
  });
});
