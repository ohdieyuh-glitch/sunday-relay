import { describe, expect, it } from 'vitest';
import {
  TRUTH_BADGE,
  completionDisplay,
  formatEventTime,
  phaseRailSteps,
} from './projections';
import type { RepairTask, ReviewFinding } from './contracts';

/**
 * Pure projection logic for the Active Project Workspace: phase rail,
 * completion display guard, truth badges, timestamps. The UI never decides
 * completion — but its DISPLAY refuses to show VERIFIED COMPLETE while a
 * visible blocker contradicts it.
 */

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  findingId: 'F-1',
  severity: 'high',
  title: 'x',
  criterion: 'c',
  evidenceSummary: 'e',
  requiredAction: 'a',
  status: 'validated',
  ...overrides,
});

const repair = (overrides: Partial<RepairTask> = {}): RepairTask => ({
  repairId: 'R-1',
  findingId: 'F-1',
  assignedTo: 'Claude Code',
  authorizedFiles: ['a.css'],
  status: 'in_progress',
  verification: 'pending',
  ...overrides,
});

describe('phase rail', () => {
  it('marks only the active phase active; future phases stay pending', () => {
    const steps = phaseRailSteps({
      phase: 'build',
      researchEnabled: true,
      repairUsed: false,
      blockingOpen: true,
      verified: false,
    });
    expect(steps.find((s) => s.phase === 'build')!.state).toBe('active');
    expect(steps.filter((s) => s.state === 'active')).toHaveLength(1);
    expect(steps.find((s) => s.phase === 'plan')!.state).toBe('complete');
    expect(steps.find((s) => s.phase === 'research')!.state).toBe('complete');
    expect(steps.find((s) => s.phase === 'verify')!.state).toBe('pending');
    expect(steps.find((s) => s.phase === 'review')!.state).toBe('pending');
  });

  it('locks COMPLETE while a blocker exists (repair active)', () => {
    const steps = phaseRailSteps({
      phase: 'repair',
      researchEnabled: true,
      repairUsed: true,
      blockingOpen: true,
      verified: false,
    });
    expect(steps.find((s) => s.phase === 'repair')!.state).toBe('active');
    expect(steps.find((s) => s.phase === 'complete')!.state).toBe('locked');
  });

  it('first-pass approval: research/repair optional, complete active, nothing locked', () => {
    const steps = phaseRailSteps({
      phase: 'complete',
      researchEnabled: false,
      repairUsed: false,
      blockingOpen: false,
      verified: true,
    });
    expect(steps.find((s) => s.phase === 'research')!.state).toBe('optional');
    expect(steps.find((s) => s.phase === 'repair')!.state).toBe('optional');
    expect(steps.find((s) => s.phase === 'complete')!.state).toBe('active');
    expect(steps.find((s) => s.phase === 'plan')!.state).toBe('complete');
    expect(steps.some((s) => s.state === 'locked')).toBe(false);
  });

  it('never represents every phase as complete by default', () => {
    const steps = phaseRailSteps({
      phase: 'plan',
      researchEnabled: true,
      repairUsed: false,
      blockingOpen: false,
      verified: false,
    });
    expect(steps.filter((s) => s.state === 'complete')).toHaveLength(0);
    expect(steps.find((s) => s.phase === 'plan')!.state).toBe('active');
  });
});

describe('completion display guard', () => {
  it('an agent claim alone never shows VERIFIED COMPLETE (verdict not_complete)', () => {
    const d = completionDisplay({
      completionState: { verdict: 'not_complete', evidence: [] },
      reviewerState: 'approved',
      findings: [],
      repairs: [],
    });
    expect(d.showVerifiedComplete).toBe(false);
  });

  it('shows VERIFIED COMPLETE only with the CompletionPolicy verdict and no blockers', () => {
    const d = completionDisplay({
      completionState: { verdict: 'verified_complete', evidence: ['tests passed'] },
      reviewerState: 'approved',
      findings: [finding({ status: 'repaired' })],
      repairs: [repair({ status: 'verified', verification: 'passed' })],
    });
    expect(d.showVerifiedComplete).toBe(true);
    expect(d.blockers).toHaveLength(0);
  });

  it('an open blocking finding blocks completion display', () => {
    const d = completionDisplay({
      completionState: { verdict: 'verified_complete', evidence: [] },
      reviewerState: 'approved',
      findings: [finding({ status: 'open', severity: 'blocking' })],
      repairs: [],
    });
    expect(d.showVerifiedComplete).toBe(false);
    expect(d.blockers.join(' ')).toContain('F-1');
  });

  it('an unresolved repair blocks completion display', () => {
    const d = completionDisplay({
      completionState: { verdict: 'verified_complete', evidence: [] },
      reviewerState: 'approved',
      findings: [],
      repairs: [repair()],
    });
    expect(d.showVerifiedComplete).toBe(false);
    expect(d.blockers.join(' ')).toContain('R-1');
  });

  it('missing or unfinished review blocks completion display', () => {
    for (const state of ['reviewing', 'waiting', 'changes_required', 're_reviewing'] as const) {
      const d = completionDisplay({
        completionState: { verdict: 'verified_complete', evidence: [] },
        reviewerState: state,
        findings: [],
        repairs: [],
      });
      expect(d.showVerifiedComplete, state).toBe(false);
    }
  });
});

describe('truth badges + time', () => {
  it('claims, evidence, review verdicts, and user actions are visually distinct classes', () => {
    const tones = new Set(Object.values(TRUTH_BADGE).map((b) => b.tone));
    expect(tones.size).toBe(5);
    expect(TRUTH_BADGE.agent_claim.label).toContain('PENDING VERIFICATION');
    expect(TRUTH_BADGE.relay_evidence.label).toBe('VERIFIED EVIDENCE');
    expect(TRUTH_BADGE.review_verdict.label).toBe('INDEPENDENT REVIEW');
    expect(TRUTH_BADGE.user_action_required.label).toBe('WAITING FOR USER');
  });

  it('formats ISO timestamps as HH:MM:SS deterministically', () => {
    expect(formatEventTime('2026-07-22T11:57:12Z')).toBe('11:57:12');
    expect(formatEventTime('not-a-time')).toBe('not-a-time');
  });
});
