import { describe, expect, it } from 'vitest';

import { PROJECT_BRAIN_COHERENCE_RULES, projectBrainCoherence } from './project-brain-coherence';
import { buildProjectBrainDocument, type ProjectBrainRows } from './project-brain-document';

/**
 * EVERY COHERENCE RULE CAN FAIL. Each case below starts from one coherent project and breaks exactly one thing; the
 * clean project must stay clean. A rule with no case that turns it on would be a check that cannot fail.
 */

const T = (minute: number) => new Date(Date.UTC(2026, 9, 4, 1, minute)).toISOString();
const RUN = 'run:a';
const OTHER = 'run:b';

const mission = (runId: string, state: string) => ({
  runId, missionId: `mission:${runId}`, state, objective: 'Do the thing', createdAt: T(0), updatedAt: T(9), cardRevision: 'card:test:1',
  contractRevision: 1, brainRevision: 0, lifecycleReason: null, lifecycleActor: null, lifecycleAt: null,
  policy: { executionMode: null, reviewRequirement: null, completionRule: null, limits: null, requestedPermissions: [], systemsInScope: [], systemsOutOfScope: [], workerRoles: [] },
});
const task = (taskId: string, runId: string, state: string) => ({ taskId, runId, role: 'CODING_AGENT', taskType: 'build', state, updatedAt: T(5) });
const transition = (transitionId: string, runId: string, toState: string, sequence: number) => ({
  transitionId, runId, fromState: 'X', toState, reasonCode: 'R', summary: '', evidenceIds: [], occurredAt: T(sequence), sequence,
});
const evidence = (evidenceId: string, runId: string) => ({
  evidenceId, runId, taskId: 't1', workerId: 'w', evidenceType: 'TEST_RUN', status: 'PASSED', summary: 'ok', integrityHash: null, occurredAt: T(4), role: null,
});

/** One coherent project: a COMPLETED mission whose every task finished, every cited thing present. */
function clean(): ProjectBrainRows {
  return {
    projectId: 'prj-1', observedAt: T(30), cursor: {}, runId: null, revision: 1, truncated: [],
    missions: [mission(RUN, 'COMPLETED'), mission(OTHER, 'EXECUTING')],
    entries: [], criteria: [{ runId: RUN, criterionId: 'c1', description: 'works', ordinal: 1, passedEvidenceIds: ['e1'], linkedEvidenceIds: ['e1'] }],
    findings: [{ findingId: 'f1', runId: RUN, taskId: 't1', reviewerWorkerId: 'rev', severity: 'HIGH', category: 'bug', claim: 'x', criterionId: null, evidenceIds: ['e1'], blocking: true, status: 'RESOLVED', createdAt: T(3), updatedAt: T(6) }],
    evidence: [evidence('e1', RUN), evidence('e2', OTHER)],
    artifacts: [],
    decisions: [{ decisionId: 'd1', runId: RUN, taskId: 't1', action: 'ACCEPT', reasonCode: 'OK', summary: '', evidenceIds: ['e1'], policyRevision: 'p1', occurredAt: T(7) }],
    repairs: [{ repairId: 'r1', runId: RUN, originalTaskId: 't1', repairTaskId: 't2', round: 1, findingIds: ['f1'], evidenceIds: ['e1'], state: 'VERIFIED', createdAt: T(4), updatedAt: T(6) }],
    approvals: [], contracts: [],
    transitions: [transition('x1', RUN, 'EXECUTING', 3), transition('x2', RUN, 'VERIFYING', 7), transition('x3', RUN, 'COMPLETED', 8)],
    trajectory: [], claims: [], contexts: [],
    tasks: [task('t1', RUN, 'SUCCEEDED'), task('t2', RUN, 'SUCCEEDED'), task('t3', RUN, 'SKIPPED'), task('t9', OTHER, 'RUNNABLE')],
    subagents: [], records: [], links: [], mutations: [], events: [], slots: [],
    components: { cards: [], selection: null, missionCards: [{ runId: RUN, cardRef: 'pbcard:default', cardVersion: 1, contentHash: 'a'.repeat(64), pinnedAt: T(1) }], handoffs: [], evals: [] },
  };
}
const rulesOf = (rows: ProjectBrainRows) => projectBrainCoherence(rows).violations.map((v) => v.rule);

describe('mission state coherence', () => {
  it('a coherent project is ok, with nothing skipped (gaps in transition versions are normal)', () => {
    expect(projectBrainCoherence(clean())).toEqual({ ok: true, violations: [], skipped: [] });
    expect(buildProjectBrainDocument(clean()).coherence.ok).toBe(true);
  });

  it('COMPLETE + ACTIVE: a completed mission with live work', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, tasks: [...rows.tasks, task('t4', RUN, 'ACTIVE')] })).toEqual(['COMPLETE_WITH_ACTIVE_WORK']);
    expect(rulesOf({ ...rows, tasks: [...rows.tasks, task('t5', RUN, 'RUNNABLE')] })).toEqual(['COMPLETE_WITH_ACTIVE_WORK']);
  });

  it('a mission still executing may have runnable work; a failed one is not judged by that rule', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, missions: [mission(RUN, 'FAILED'), mission(OTHER, 'EXECUTING')], transitions: [transition('x1', RUN, 'FAILED', 3)], tasks: [...rows.tasks, task('t4', RUN, 'RUNNABLE')] })).toEqual([]);
  });

  it('an accepted (COMPLETED) mission with a blocking finding still OPEN', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, findings: rows.findings.map((f) => ({ ...f, status: 'OPEN' })) })).toEqual(['COMPLETED_WITH_OPEN_BLOCKER']);
    expect(rulesOf({ ...rows, findings: rows.findings.map((f) => ({ ...f, status: 'OPEN', blocking: false })) }), 'a non-blocking open finding is allowed').toEqual([]);
  });

  it('duplicated completion and a stale overwrite of the run version', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, transitions: [...rows.transitions, transition('x4', RUN, 'COMPLETED', 9)] })).toEqual(['DUPLICATE_COMPLETION']);
    expect(rulesOf({ ...rows, transitions: [transition('x1', RUN, 'EXECUTING', 3), transition('x2', RUN, 'VERIFYING', 3), transition('x3', RUN, 'COMPLETED', 8)] })).toEqual(['NON_MONOTONIC_TRANSITIONS']);
    expect(rulesOf({ ...rows, missions: [mission(RUN, 'COMPLETED'), mission(OTHER, 'EXECUTING')], transitions: rows.transitions.slice(0, 2) }), 'a state written without its transition').toEqual(['NON_MONOTONIC_TRANSITIONS']);
  });

  it('a repair whose parent cannot be identified', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, repairs: rows.repairs.map((r) => ({ ...r, originalTaskId: 'ghost' })) })).toEqual(['ORPHAN_REPAIR']);
    expect(rulesOf({ ...rows, repairs: rows.repairs.map((r) => ({ ...r, findingIds: ['f-elsewhere'] })) })).toEqual(['ORPHAN_REPAIR']);
    expect(rulesOf({ ...rows, repairs: rows.repairs.map((r) => ({ ...r, repairTaskId: 't9' })) }), 'a task of ANOTHER mission is not this repair\'s').toEqual(['ORPHAN_REPAIR']);
  });
});

describe('evidence linkage', () => {
  it('evidence cited but not held: a missing artifact represented as present', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, decisions: rows.decisions.map((d) => ({ ...d, evidenceIds: ['e-missing'] })) })).toEqual(['EVIDENCE_NOT_PRESENT']);
    expect(rulesOf({ ...rows, criteria: rows.criteria.map((c) => ({ ...c, linkedEvidenceIds: ['e-missing'] })) })).toEqual(['EVIDENCE_NOT_PRESENT']);
  });

  it('evidence of another mission cannot support this one', () => {
    const rows = clean();
    expect(rulesOf({ ...rows, findings: rows.findings.map((f) => ({ ...f, evidenceIds: ['e2'] })) })).toEqual(['EVIDENCE_FROM_ANOTHER_MISSION']);
  });

  it('a component naming a mission the project does not hold', () => {
    const rows = clean();
    const components = rows.components!;
    expect(rulesOf({ ...rows, components: { ...components, missionCards: [{ ...components.missionCards[0]!, runId: 'run:ghost' }] } })).toEqual(['PIN_ON_UNKNOWN_MISSION']);
    expect(rulesOf({ ...rows, components: { ...components, handoffs: [{ runId: 'run:ghost', state: 'HANDED_OFF', form: 'angelic_twin_swords', version: 1, updatedAt: T(2) }] } })).toEqual(['HANDOFF_ON_UNKNOWN_MISSION']);
  });
});

describe('a window cannot prove an absence', () => {
  it('a truncated set SKIPS the rules that read it, names them, and the report is not ok', () => {
    const coherence = projectBrainCoherence({ ...clean(), truncated: ['tasks', 'evidence'] });
    expect(coherence.ok).toBe(false);
    expect(coherence.skipped).toEqual([
      'COMPLETE_WITH_ACTIVE_WORK (truncated: tasks)', 'EVIDENCE (truncated: evidence)', 'ORPHAN_REPAIR (truncated: tasks)',
    ]);
    // ...and a skipped rule SAYS NOTHING about what it could not see. The window below holds none of the evidence the
    // decision cites and none of the repair's tasks: cut, both are merely unseen, never "missing" (mutant PM-06 ran the
    // rules on the window anyway and reported both as absences while still naming them skipped).
    const rows = clean();
    const unseen = projectBrainCoherence({ ...rows, truncated: ['evidence', 'tasks'], evidence: [], tasks: [] });
    expect(unseen.violations, 'nothing outside the window is reported missing').toEqual([]);
    expect(unseen.ok).toBe(false);
    // The control: the same rows NOT cut report both absences, so the assertion above can fail.
    expect(rulesOf({ ...rows, evidence: [], tasks: [] })).toEqual(expect.arrayContaining(['EVIDENCE_NOT_PRESENT', 'ORPHAN_REPAIR']));
  });

  it('every rule in the vocabulary has a case above that turns it on', () => {
    const fired = new Set<string>();
    const rows = clean();
    const components = rows.components!;
    for (const variant of [
      { ...rows, tasks: [...rows.tasks, task('t4', RUN, 'ACTIVE')] },
      { ...rows, findings: rows.findings.map((f) => ({ ...f, status: 'OPEN' })) },
      { ...rows, transitions: [...rows.transitions, transition('x4', RUN, 'COMPLETED', 9)] },
      { ...rows, transitions: [transition('x1', RUN, 'EXECUTING', 3), transition('x2', RUN, 'COMPLETED', 3)] },
      { ...rows, repairs: rows.repairs.map((r) => ({ ...r, originalTaskId: 'ghost' })) },
      { ...rows, decisions: rows.decisions.map((d) => ({ ...d, evidenceIds: ['e-missing'] })) },
      { ...rows, findings: rows.findings.map((f) => ({ ...f, evidenceIds: ['e2'] })) },
      { ...rows, components: { ...components, missionCards: [{ ...components.missionCards[0]!, runId: 'run:ghost' }] } },
      { ...rows, components: { ...components, handoffs: [{ runId: 'run:ghost', state: 'HANDED_OFF' as const, form: 'f', version: 1, updatedAt: T(2) }] } },
    ]) for (const rule of rulesOf(variant)) fired.add(rule);
    expect([...fired].sort()).toEqual([...PROJECT_BRAIN_COHERENCE_RULES].sort());
  });
});
