import { describe, expect, it } from 'vitest';

import {
  AWAITING_OPERATOR_WINDOW_MS,
  GITHUB_HOSTED_JOB_CAP_MS,
  PAID_SLOT_WINDOW_MS,
  POST_DISPATCH_ADMISSION_TERMINAL_CAUSES,
  POST_DISPATCH_ADMISSION_TERMINAL_STATES,
  SLOT_SPENT_TAG_TERMINAL_STATES,
  applyWonderlandStatusTransition,
  evaluateWonderlandAdmissionClock,
} from './admission-contract';

const ACCEPTED_AT_MS = Date.parse('2026-10-23T17:18:00.000Z');

describe('post-dispatch admission terminals are refused', () => {
  it('tries every INTERRUPTED and FAILED spelling and matching cause', () => {
    const causes: Array<string | null> = [null, ...POST_DISPATCH_ADMISSION_TERMINAL_CAUSES];
    for (const proposedState of POST_DISPATCH_ADMISSION_TERMINAL_STATES) {
      for (const proposedCause of causes) {
        const refused = applyWonderlandStatusTransition({
          dispatched: true,
          proposedState,
          proposedCause,
        });
        expect(refused.ok, `${proposedState} / ${String(proposedCause)}`).toBe(false);
        if (!refused.ok) expect(refused.reason).toBe('post_dispatch_admission_terminal_refused');
      }
    }
    for (const proposedCause of POST_DISPATCH_ADMISSION_TERMINAL_CAUSES) {
      const refused = applyWonderlandStatusTransition({
        dispatched: true,
        proposedState: 'dispatched',
        proposedCause,
      });
      expect(refused.ok, `dispatched / ${proposedCause}`).toBe(false);
    }
  });

  it('still accepts those writes before a dispatch is recorded', () => {
    for (const proposedState of ['INTERRUPTED', 'FAILED'] as const) {
      const allowed = applyWonderlandStatusTransition({
        dispatched: false,
        proposedState,
        proposedCause: null,
      });
      expect(allowed.ok, proposedState).toBe(true);
      if (allowed.ok) {
        expect(allowed.projection.state).toBe(proposedState === 'INTERRUPTED' ? 'interrupted' : 'failed');
        expect(allowed.projection.cause).toBeUndefined();
      }
    }
  });

  it('after dispatch, only a slot or spent-tag terminal is accepted', () => {
    expect(applyWonderlandStatusTransition({
      dispatched: true,
      proposedState: 'already_spent',
      proposedCause: 'RUN_ID_ALREADY_SPENT',
    })).toEqual({ ok: true, projection: { state: 'already_spent', cause: 'RUN_ID_ALREADY_SPENT' } });
    expect(applyWonderlandStatusTransition({
      dispatched: true,
      proposedState: 'dispatch_failed',
      proposedCause: 'SPENT_TAG_UNVERIFIED',
    })).toEqual({ ok: true, projection: { state: 'dispatch_failed', cause: 'SPENT_TAG_UNVERIFIED' } });
    expect(applyWonderlandStatusTransition({
      dispatched: true,
      proposedState: 'dispatch_failed',
      proposedCause: 'gh_workflow_run_failed',
    })).toEqual({ ok: true, projection: { state: 'dispatch_failed', cause: 'gh_workflow_run_failed' } });
    for (const state of SLOT_SPENT_TAG_TERMINAL_STATES) {
      expect(applyWonderlandStatusTransition({
        dispatched: true,
        proposedState: state,
        proposedCause: null,
      }).ok, state).toBe(true);
    }
    const expired = applyWonderlandStatusTransition({
      dispatched: true,
      proposedState: 'failed',
      proposedCause: 'AWAITING_OPERATOR_EXPIRED',
    });
    expect(expired.ok).toBe(false);
    const ledger = applyWonderlandStatusTransition({
      dispatched: true,
      proposedState: 'ledger_unwritten',
      proposedCause: null,
    });
    expect(ledger.ok).toBe(false);
  });
});

describe('L-6 clocks', () => {
  it('keeps the slot window inside the hosted-job cap, on a different clock from the held phase', () => {
    expect(PAID_SLOT_WINDOW_MS).toBe(350 * 60_000);
    expect(AWAITING_OPERATOR_WINDOW_MS).toBe(360 * 60_000);
    expect(GITHUB_HOSTED_JOB_CAP_MS).toBe(360 * 60_000);
    expect(PAID_SLOT_WINDOW_MS).toBeLessThan(GITHUB_HOSTED_JOB_CAP_MS);
  });

  it('awaiting_operator is open at exactly the window and expired one millisecond later', () => {
    const open = evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: ACCEPTED_AT_MS + AWAITING_OPERATOR_WINDOW_MS,
      dispatchedAtMs: null,
    });
    expect(open).toEqual({
      kind: 'awaiting_operator',
      expiresAtMs: ACCEPTED_AT_MS + AWAITING_OPERATOR_WINDOW_MS,
    });
    const expired = evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: ACCEPTED_AT_MS + AWAITING_OPERATOR_WINDOW_MS + 1,
      dispatchedAtMs: null,
    });
    expect(expired.kind).toBe('operator_expired');
    if (expired.kind === 'operator_expired') {
      expect(expired.projection).toEqual({ state: 'failed', cause: 'AWAITING_OPERATOR_EXPIRED' });
      expect(expired.expiredAtMs).toBe(ACCEPTED_AT_MS + AWAITING_OPERATOR_WINDOW_MS + 1);
    }
  });

  it('starts the slot window at the recorded dispatch, including one that lands after the held phase would have expired', () => {
    const dispatchedAtMs = ACCEPTED_AT_MS + 20 * 60_000;
    const atCapFromAccepted = evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: ACCEPTED_AT_MS + GITHUB_HOSTED_JOB_CAP_MS,
      dispatchedAtMs,
    });
    expect(atCapFromAccepted.kind).toBe('slot');
    if (atCapFromAccepted.kind !== 'slot') return;
    expect(atCapFromAccepted.startsAtMs).toBe(dispatchedAtMs);
    expect(atCapFromAccepted.endsAtMs).toBe(dispatchedAtMs + PAID_SLOT_WINDOW_MS);
    expect(atCapFromAccepted.endsAtMs).not.toBe(ACCEPTED_AT_MS + GITHUB_HOSTED_JOB_CAP_MS);
    expect(atCapFromAccepted.elapsed).toBe(false);

    const lastOpenMs = dispatchedAtMs + PAID_SLOT_WINDOW_MS;
    const stillOpen = evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: lastOpenMs,
      dispatchedAtMs,
    });
    expect(stillOpen.kind === 'slot' && stillOpen.elapsed).toBe(false);
    const elapsed = evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: lastOpenMs + 1,
      dispatchedAtMs,
    });
    expect(elapsed.kind === 'slot' && elapsed.elapsed).toBe(true);

    const claimedAfterExpiry = evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: ACCEPTED_AT_MS + AWAITING_OPERATOR_WINDOW_MS + 5,
      dispatchedAtMs: ACCEPTED_AT_MS + AWAITING_OPERATOR_WINDOW_MS + 1,
    });
    expect(claimedAfterExpiry.kind).toBe('slot');
  });

  it('an unreadable clock is not an expiry', () => {
    expect(evaluateWonderlandAdmissionClock({
      acceptedAtMs: Number.NaN,
      nowMs: ACCEPTED_AT_MS,
      dispatchedAtMs: null,
    }).kind).toBe('unreadable');
    expect(evaluateWonderlandAdmissionClock({
      acceptedAtMs: ACCEPTED_AT_MS,
      nowMs: Number.NaN,
      dispatchedAtMs: ACCEPTED_AT_MS,
    }).kind).toBe('unreadable');
  });
});
