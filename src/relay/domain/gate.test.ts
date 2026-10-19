import { describe, expect, it } from 'vitest';
import { verifyMission } from './gate';
import { createMission } from './stages';
import type { RelayMission, ReviewReport } from './types';

const T = (h: number) => `2026-07-21T${String(h).padStart(2, '0')}:00:00.000Z`;

function fullMission(overrides: Partial<RelayMission> = {}): RelayMission {
  const created = createMission(
    {
      title: 'Gate fixture',
      objective: 'Exercise the verification gate.',
      acceptanceCriteria: ['gate passes'],
    },
    { id: 'm-gate', at: T(9) },
  );
  if (!created.ok) throw new Error('fixture invalid');
  return {
    ...created.value,
    handoff: { kind: 'implementer-handoff', generatedAt: T(9), markdown: '#' },
    implementationReport: {
      receivedAt: T(10),
      agent: 'Claude Code (Fable 5)',
      summary: 'Implemented.',
      changedFiles: ['a.ts'],
    },
    review: {
      receivedAt: T(11),
      reviewer: 'OpenAI Codex',
      verdict: 'changes-requested',
      findings: [
        { id: 'R1', severity: 'major', title: 'Bug', detail: 'Broken.' },
        { id: 'R2', severity: 'minor', title: 'Nit', detail: 'Sloppy.' },
      ],
    },
    repairTask: { kind: 'repair-task', generatedAt: T(11), markdown: '#', findingIds: ['R1', 'R2'] },
    repairReport: {
      receivedAt: T(12),
      agent: 'Claude Code (Fable 5)',
      summary: 'Fixed both.',
      resolvedFindings: [
        { id: 'R1', resolution: 'Fixed.' },
        { id: 'R2', resolution: 'Cleaned.' },
      ],
      changedFiles: ['a.ts'],
    },
    evidence: {
      receivedAt: T(13),
      entries: [
        { command: 'npm run typecheck', status: 'pass', output: 'clean' },
        { command: 'npx vitest run', status: 'pass', output: 'all passed' },
      ],
    },
    ...overrides,
  };
}

function failedCheckIds(m: RelayMission): string[] {
  return verifyMission(m)
    .checks.filter((c) => !c.ok)
    .map((c) => c.id);
}

describe('verification gate', () => {
  it('passes the full repaired golden path', () => {
    const result = verifyMission(fullMission());
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.id)).toEqual([
      'implementation-report',
      'independent-review',
      'reviewer-independent',
      'repair-report',
      'findings-resolved',
      'evidence-present',
      'evidence-green',
      'evidence-fresh',
    ]);
  });

  it('passes a clean approval with evidence, repair not required', () => {
    const clean: ReviewReport = {
      receivedAt: T(11),
      reviewer: 'OpenAI Codex',
      verdict: 'approved',
      findings: [],
    };
    const m = fullMission({ review: clean, repairTask: undefined, repairReport: undefined });
    const result = verifyMission(m);
    expect(result.ok).toBe(true);
    const resolved = result.checks.find((c) => c.id === 'findings-resolved');
    expect(resolved?.detail).toContain('Clean approval');
  });

  it('fails when reports are missing', () => {
    expect(failedCheckIds(fullMission({ implementationReport: undefined }))).toContain(
      'implementation-report',
    );
    expect(failedCheckIds(fullMission({ review: undefined }))).toContain('independent-review');
    expect(failedCheckIds(fullMission({ repairReport: undefined }))).toEqual(
      expect.arrayContaining(['repair-report', 'findings-resolved']),
    );
    expect(failedCheckIds(fullMission({ evidence: undefined }))).toContain('evidence-present');
  });

  it('fails on a self-review (reviewer == implementer)', () => {
    const m = fullMission({
      review: { ...fullMission().review!, reviewer: 'claude code (fable 5)' },
    });
    const ids = failedCheckIds(m);
    expect(ids).toContain('reviewer-independent');
  });

  it('fails on unresolved and unknown finding ids', () => {
    const unresolved = fullMission({
      repairReport: {
        ...fullMission().repairReport!,
        resolvedFindings: [{ id: 'R1', resolution: 'Fixed.' }],
      },
    });
    const r1 = verifyMission(unresolved);
    expect(r1.ok).toBe(false);
    expect(r1.checks.find((c) => c.id === 'findings-resolved')?.detail).toContain('R2');

    const unknown = fullMission({
      repairReport: {
        ...fullMission().repairReport!,
        resolvedFindings: [
          { id: 'R1', resolution: 'Fixed.' },
          { id: 'R2', resolution: 'Cleaned.' },
          { id: 'R9', resolution: 'Typo id.' },
        ],
      },
    });
    const r2 = verifyMission(unknown);
    expect(r2.ok).toBe(false);
    expect(r2.checks.find((c) => c.id === 'findings-resolved')?.detail).toContain('R9');
  });

  it('fails on failing or stale evidence', () => {
    const failing = fullMission({
      evidence: {
        receivedAt: T(13),
        entries: [{ command: 'npx vitest run', status: 'fail', output: '2 failed' }],
      },
    });
    expect(failedCheckIds(failing)).toContain('evidence-green');

    const stale = fullMission({
      evidence: {
        receivedAt: T(11), // before the repair at T(12)
        entries: [{ command: 'npx vitest run', status: 'pass', output: 'passed' }],
      },
    });
    expect(failedCheckIds(stale)).toContain('evidence-fresh');
  });

  it('freshness baseline is the implementation report when repair was skipped', () => {
    const clean: ReviewReport = {
      receivedAt: T(11),
      reviewer: 'OpenAI Codex',
      verdict: 'approved',
      findings: [],
    };
    const stale = fullMission({
      review: clean,
      repairTask: undefined,
      repairReport: undefined,
      evidence: {
        receivedAt: T(9), // before implementation at T(10)
        entries: [{ command: 'npx vitest run', status: 'pass', output: 'passed' }],
      },
    });
    expect(failedCheckIds(stale)).toContain('evidence-fresh');
  });
});
