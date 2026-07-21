import { describe, expect, it } from 'vitest';
import {
  completedStages,
  createMission,
  currentStage,
  nextAction,
  RELAY_STAGES,
  reviewRequiresRepair,
  STAGE_ORDER,
} from './stages';
import type {
  ImplementationReport,
  RelayMission,
  RepairReport,
  ReviewReport,
  TestEvidence,
} from './types';

const T0 = '2026-07-21T10:00:00.000Z';

function mission(overrides: Partial<RelayMission> = {}): RelayMission {
  const created = createMission(
    {
      title: 'Add spend cap banner',
      objective: 'Show the anonymous spend cap in the composer.',
      acceptanceCriteria: ['Banner visible for anonymous users'],
    },
    { id: 'm-test', at: T0 },
  );
  if (!created.ok) throw new Error(created.errors.join(', '));
  return { ...created.value, ...overrides };
}

const handoff = { kind: 'implementer-handoff' as const, generatedAt: T0, markdown: '# Handoff' };
const implReport: ImplementationReport = {
  receivedAt: T0,
  agent: 'Claude Code (Fable 5)',
  summary: 'Implemented the banner.',
  changedFiles: ['src/components/Composer.tsx'],
};
const cleanReview: ReviewReport = {
  receivedAt: T0,
  reviewer: 'OpenAI Codex',
  verdict: 'approved',
  findings: [],
};
const failingReview: ReviewReport = {
  receivedAt: T0,
  reviewer: 'OpenAI Codex',
  verdict: 'changes-requested',
  findings: [
    { id: 'R1', severity: 'major', title: 'Banner leaks for signed-in users', detail: 'Shown unconditionally.' },
  ],
};
const repairTask = {
  kind: 'repair-task' as const,
  generatedAt: T0,
  markdown: '# Repair',
  findingIds: ['R1'],
};
const repairReport: RepairReport = {
  receivedAt: T0,
  agent: 'Claude Code (Fable 5)',
  summary: 'Gated banner on anonymous session.',
  resolvedFindings: [{ id: 'R1', resolution: 'Added session check.' }],
  changedFiles: ['src/components/Composer.tsx'],
};
const evidence: TestEvidence = {
  receivedAt: T0,
  entries: [{ command: 'npx vitest run', status: 'pass', output: '1440 passed' }],
};
const verification = { at: T0, ok: true as const, checks: [] };

describe('createMission', () => {
  it('rejects blank title, objective, and empty acceptance criteria with all errors at once', () => {
    const result = createMission(
      { title: '  ', objective: '', acceptanceCriteria: ['  '] },
      { id: 'm', at: T0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  it('trims fields, drops empty list items, and seeds the ledger', () => {
    const result = createMission(
      {
        title: '  Mission  ',
        objective: ' Do the thing ',
        context: '  ',
        constraints: [' no shared files ', ''],
        acceptanceCriteria: [' tests green ', '  '],
      },
      { id: 'm-1', at: T0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Mission');
    expect(result.value.context).toBeUndefined();
    expect(result.value.constraints).toEqual(['no shared files']);
    expect(result.value.acceptanceCriteria).toEqual(['tests green']);
    expect(result.value.ledger).toEqual([
      { at: T0, stage: 'mission', summary: 'Mission created: Mission' },
    ]);
  });
});

describe('golden-path stage derivation', () => {
  it('declares all 8 stages in golden-path order', () => {
    expect(STAGE_ORDER).toEqual([
      'mission',
      'handoff',
      'implementation',
      'review',
      'repair-task',
      'repair',
      'evidence',
      'verified',
    ]);
    expect(RELAY_STAGES).toHaveLength(8);
  });

  it('walks every stage of the full repair path in order', () => {
    const steps: Array<[RelayMission, string, string]> = [
      // currentStage = the next milestone to achieve (fresh mission → 'handoff')
      [mission(), 'handoff', 'generate-handoff'],
      [mission({ handoff }), 'implementation', 'ingest-implementation-report'],
      [mission({ handoff, implementationReport: implReport }), 'review', 'ingest-review'],
      [
        mission({ handoff, implementationReport: implReport, review: failingReview }),
        'repair-task',
        'generate-repair-task',
      ],
      [
        mission({ handoff, implementationReport: implReport, review: failingReview, repairTask }),
        'repair',
        'ingest-repair-report',
      ],
      [
        mission({
          handoff,
          implementationReport: implReport,
          review: failingReview,
          repairTask,
          repairReport,
        }),
        'evidence',
        'ingest-evidence',
      ],
      [
        mission({
          handoff,
          implementationReport: implReport,
          review: failingReview,
          repairTask,
          repairReport,
          evidence,
        }),
        'verified',
        'mark-verified',
      ],
      [
        mission({
          handoff,
          implementationReport: implReport,
          review: failingReview,
          repairTask,
          repairReport,
          evidence,
          verification,
        }),
        'verified',
        'complete',
      ],
    ];
    for (const [m, stage, action] of steps) {
      expect(currentStage(m)).toBe(stage);
      expect(nextAction(m).type).toBe(action);
    }
  });

  it('a clean approval (zero findings) skips both repair stages', () => {
    const m = mission({ handoff, implementationReport: implReport, review: cleanReview });
    expect(reviewRequiresRepair(cleanReview)).toBe(false);
    const done = completedStages(m);
    expect(done.has('repair-task')).toBe(true);
    expect(done.has('repair')).toBe(true);
    expect(currentStage(m)).toBe('evidence');
    expect(nextAction(m).type).toBe('ingest-evidence');
  });

  it('changes-requested requires repair even with zero listed findings', () => {
    const odd: ReviewReport = { ...cleanReview, verdict: 'changes-requested' };
    expect(reviewRequiresRepair(odd)).toBe(true);
    const m = mission({ handoff, implementationReport: implReport, review: odd });
    expect(nextAction(m).type).toBe('generate-repair-task');
  });

  it('an approved review that still lists findings requires repair', () => {
    const politeButFirm: ReviewReport = { ...failingReview, verdict: 'approved' };
    expect(reviewRequiresRepair(politeButFirm)).toBe(true);
  });
});
