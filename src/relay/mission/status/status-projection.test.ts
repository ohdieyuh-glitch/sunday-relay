import { describe, expect, it } from 'vitest';

import { projectAqualaStatus } from './status-projection';
import { AQUALA_STATUS_VALUES, createInitialAqualaOutcomeStatus } from './status-model';
import type { AqualaOutcomeStatus } from './status-model';
import { adaptRelayMissionState } from './legacy-compat';

function statusWith(overrides: Partial<AqualaOutcomeStatus>): AqualaOutcomeStatus {
  return { ...createInitialAqualaOutcomeStatus(), ...overrides };
}

describe('projectAqualaStatus', () => {
  it('always projects exactly four chips in fixed dimension order', () => {
    const projection = projectAqualaStatus(createInitialAqualaOutcomeStatus());
    expect(projection.chips.map(chip => chip.dimension)).toEqual([
      'execution',
      'outcome',
      'verification',
      'release',
    ]);
  });

  it('covers every canonical status value with a non-empty ALL-CAPS label', () => {
    for (const executionStatus of AQUALA_STATUS_VALUES.execution) {
      for (const outcomeStatus of AQUALA_STATUS_VALUES.outcome) {
        const projection = projectAqualaStatus(statusWith({ executionStatus, outcomeStatus }));
        for (const chip of projection.chips) {
          expect(chip.label.length).toBeGreaterThan(0);
          expect(chip.label).toBe(chip.label.toUpperCase());
        }
      }
    }
    for (const verificationStatus of AQUALA_STATUS_VALUES.verification) {
      for (const releaseStatus of AQUALA_STATUS_VALUES.release) {
        const projection = projectAqualaStatus(statusWith({ verificationStatus, releaseStatus }));
        for (const chip of projection.chips) {
          expect(chip.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('never collapses the four dimensions into a single complete', () => {
    // Execution finished, but nothing proven: the headline must still carry
    // all four truths — never a lone "COMPLETE".
    const projection = projectAqualaStatus(statusWith({ executionStatus: 'completed' }));
    expect(projection.headline).toBe(
      'COMPLETE · OUTCOME UNKNOWN · UNVERIFIED · NOT ELIGIBLE',
    );
    expect(projection.releaseGatesMet).toBe(false);
  });

  it('projects the canonical initial status as fully idle', () => {
    const projection = projectAqualaStatus(createInitialAqualaOutcomeStatus());
    expect(projection.headline).toBe(
      'NOT STARTED · OUTCOME UNKNOWN · UNVERIFIED · NOT ELIGIBLE',
    );
    expect(projection.chips.every(chip => chip.tone === 'idle')).toBe(true);
    expect(projection.blocked).toBe(false);
    expect(projection.awaitingHumanApproval).toBe(false);
  });

  it('marks blocked only for changes_required or a violated outcome', () => {
    expect(
      projectAqualaStatus(statusWith({ verificationStatus: 'changes_required' })).blocked,
    ).toBe(true);
    expect(projectAqualaStatus(statusWith({ outcomeStatus: 'violated' })).blocked).toBe(true);
    expect(projectAqualaStatus(statusWith({ executionStatus: 'failed' })).blocked).toBe(false);
  });

  it('surfaces the human-approval wait distinctly', () => {
    const projection = projectAqualaStatus(
      statusWith({
        executionStatus: 'completed',
        outcomeStatus: 'satisfied',
        verificationStatus: 'verified',
        releaseStatus: 'human_approval_required',
      }),
    );
    expect(projection.awaitingHumanApproval).toBe(true);
    expect(projection.releaseGatesMet).toBe(true);
    expect(projection.releaseGatesUnmet).toEqual([]);
    expect(projection.headline).toBe(
      'COMPLETE · SATISFIED · VERIFIED · HUMAN APPROVAL REQUIRED',
    );
  });

  it('reports unmet release gates verbatim from the domain derivation', () => {
    const projection = projectAqualaStatus(statusWith({ executionStatus: 'running' }));
    expect(projection.releaseGatesUnmet).toEqual([
      'outcome is not satisfied',
      'verification is not verified',
    ]);
  });

  it('presents a cancelled execution as a safe stop, not a failure', () => {
    const projection = projectAqualaStatus(statusWith({ executionStatus: 'cancelled' }));
    expect(projection.chips[0].label).toBe('STOPPED SAFELY');
    expect(projection.chips[0].tone).toBe('attention');
  });

  it('projects every adapted legacy mission state without throwing', () => {
    const states = [
      'configured',
      'ready',
      'architect_working',
      'handoff_ready',
      'coding',
      'claim_submitted',
      'relay_verifying',
      'reviewer_reviewing',
      'repair_required',
      'repair_in_progress',
      're_verifying',
      'approved',
      'verified_complete',
      'failed',
      'cancelled',
    ] as const;
    for (const state of states) {
      const projection = projectAqualaStatus(adaptRelayMissionState(state));
      expect(projection.chips).toHaveLength(4);
      expect(projection.headline).toContain(' · ');
    }
  });

  it('is a pure function of its inputs', () => {
    const status = Object.freeze(statusWith({ executionStatus: 'running' }));
    const first = projectAqualaStatus(status);
    const second = projectAqualaStatus(status);
    expect(first).toEqual(second);
    expect(status.executionStatus).toBe('running');
  });
});
