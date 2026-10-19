import { describe, expect, it } from 'vitest';

import { deriveJuliusContextQualification } from '../julius/julius-context-provenance';
import { encodeProjectBrainCursor, type ProjectBrainActor } from './project-brain';
import {
  PROJECT_BRAIN_SECTIONS,
  buildProjectBrainDocument,
  type PbRecordRow,
  type ProjectBrainRows,
} from './project-brain-document';
import {
  WONDERLAND_BRAIN_SURFACES,
  projectBrainCompanionContext,
  projectBrainContextEntries,
  projectWonderlandBrainView,
  wonderlandProposeDomainFor,
  wonderlandSurfaceIsReviewable,
} from './project-brain-views';

/**
 * THE PANEL'S OWN SURFACE IDS, in its own order, copied from
 * `wonderland/Source/Wonderland/WonderlandProjectBrain.cpp` (BuildDevelopmentPreview,
 * local/wonderland-task3 3aa43e1f) with the access each declares there. The
 * backend must answer every one of them by that id, or the existing panel would
 * draw an empty tile for a surface the server named differently.
 */
const PANEL_SURFACES: ReadonlyArray<readonly [string, 'YOURS' | 'REVIEW' | 'SYSTEM']> = [
  ['user_facts', 'YOURS'], ['learned_facts', 'REVIEW'], ['preferences', 'YOURS'], ['identity', 'YOURS'],
  ['session_history', 'SYSTEM'], ['past_actions', 'SYSTEM'], ['user_events', 'SYSTEM'], ['agent_experiences', 'SYSTEM'],
  ['instructions', 'YOURS'], ['prompt_systems', 'SYSTEM'], ['workflows', 'YOURS'], ['skills', 'SYSTEM'],
  ['scratchpads', 'YOURS'], ['memory_synthesis', 'SYSTEM'], ['auto_memories', 'REVIEW'], ['context_handoffs', 'SYSTEM'], ['agent_state', 'SYSTEM'],
  ['prompt_architect', 'SYSTEM'], ['coding_agent', 'SYSTEM'], ['independent_reviewer', 'SYSTEM'], ['shared_context', 'YOURS'],
  ['objective', 'SYSTEM'], ['requirements', 'YOURS'], ['constraints', 'YOURS'], ['decisions', 'SYSTEM'], ['evidence', 'SYSTEM'],
  ['evaluations', 'SYSTEM'], ['trace', 'SYSTEM'], ['governance', 'SYSTEM'],
];

const PLAYER: ProjectBrainActor = { kind: 'WONDERLAND_PLAYER', id: 'player-1' };
const T = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute)).toISOString();

const record = (over: Partial<PbRecordRow>): PbRecordRow => ({
  recordId: 'pbr:00000000-0000-4000-8000-000000000001', runId: null, scope: 'PROJECT', domain: 'USER_FACT', status: 'ACTIVE',
  title: 'Wonderland is built in Unreal Engine 5.8.', body: '', subjectRef: null, version: 1, contentHash: 'a'.repeat(64),
  author: PLAYER, deliverer: { kind: 'WONDERLAND_CLIENT', id: 'wonderland-session:s1' }, createdAt: T(1), updatedAt: T(1), ...over,
});

function rows(over: Partial<ProjectBrainRows> = {}): ProjectBrainRows {
  return {
    projectId: 'prj-1', observedAt: T(30), cursor: { 'run:a': 3 }, runId: null, revision: 7, truncated: [],
    missions: [{
      runId: 'run:a', missionId: 'mission:a', state: 'EXECUTING', objective: 'Compare three save formats.', createdAt: T(0), updatedAt: T(10),
      cardRevision: 'card:1', contractRevision: 1, brainRevision: 5, lifecycleReason: null, lifecycleActor: null, lifecycleAt: null,
      policy: { executionMode: 'autonomous', reviewRequirement: 'independent', completionRule: 'all_blocking_criteria_and_independent_review',
        limits: { spendUsd: 2, repairCycles: 1 }, requestedPermissions: ['read'], systemsInScope: [], systemsOutOfScope: ['billing'], workerRoles: ['CODING_AGENT'] },
    }, {
      runId: 'run:b', missionId: 'mission:b', state: 'COMPLETED', objective: 'Another mission.', createdAt: T(0), updatedAt: T(5),
      cardRevision: 'card:1', contractRevision: 1, brainRevision: 2, lifecycleReason: null, lifecycleActor: null, lifecycleAt: null,
      policy: { executionMode: null, reviewRequirement: null, completionRule: null, limits: null, requestedPermissions: [], systemsInScope: [], systemsOutOfScope: [], workerRoles: [] },
    }],
    entries: [
      { entryId: 'run:a:objective', runId: 'run:a', taskId: null, workerId: 'relay-bootstrap', kind: 'CONSTRAINT', text: 'OBJECTIVE: Compare three save formats.', evidenceIds: [], revision: 1, createdAt: T(0) },
      { entryId: 'run:a:requirement:0', runId: 'run:a', taskId: null, workerId: 'relay-bootstrap', kind: 'ACCEPTANCE_UPDATE', text: 'REQUIREMENT: Size and load time.', evidenceIds: [], revision: 2, createdAt: T(0) },
      { entryId: 'run:a:constraint:0', runId: 'run:a', taskId: null, workerId: 'relay-bootstrap', kind: 'CONSTRAINT', text: 'CONSTRAINT: Touch only docs/.', evidenceIds: [], revision: 3, createdAt: T(0) },
      { entryId: 'run:a:criteria', runId: 'run:a', taskId: null, workerId: 'relay-bootstrap', kind: 'ACCEPTANCE_UPDATE', text: 'ACCEPTANCE CRITERIA: [AC-1] x', evidenceIds: [], revision: 4, createdAt: T(0) },
      { entryId: 'brain:research-answer:t9', runId: 'run:a', taskId: 'run:a:plan', workerId: 'architect-1', kind: 'HANDOFF', text: 'The vendor changelog says v2 is stable.', evidenceIds: [], revision: 5, createdAt: T(6) },
      { entryId: 'carried:run:b:brain:decision:x', runId: 'run:a', taskId: null, workerId: 'julius', kind: 'DECISION', text: 'Mission B verified the loader.', evidenceIds: ['ev-b'], revision: 6, createdAt: T(1) },
      { entryId: 'brain:decision:run:a:plan:ACCEPT:ok', runId: 'run:a', taskId: 'run:a:plan', workerId: 'julius', kind: 'DECISION', text: 'context copy', evidenceIds: [], revision: 7, createdAt: T(7) },
    ],
    criteria: [{ runId: 'run:a', criterionId: 'AC-1', description: 'The comparison exists.', ordinal: 0, passedEvidenceIds: ['ev-1'], linkedEvidenceIds: ['ev-1'] }],
    findings: [{ findingId: 'f-1', runId: 'run:a', taskId: 'run:a:build', reviewerWorkerId: 'reviewer-1', severity: 'HIGH', category: 'correctness', claim: 'Load time is not measured.',
      criterionId: 'AC-1', evidenceIds: ['ev-1'], blocking: true, status: 'OPEN', createdAt: T(8), updatedAt: T(8) }],
    evidence: [{ evidenceId: 'ev-1', runId: 'run:a', taskId: 'run:a:plan', workerId: 'architect-1', evidenceType: 'ARTIFACT', status: 'PASSED', summary: 'Plan written.', integrityHash: null, occurredAt: T(6), role: 'PROMPT_ARCHITECT' }],
    artifacts: [],
    decisions: [{ decisionId: 'd-1', runId: 'run:a', taskId: 'run:a:plan', action: 'ACCEPT', reasonCode: 'evidence_passed', summary: 'Plan accepted.', evidenceIds: ['ev-1'], policyRevision: 'p1', occurredAt: T(7) }],
    repairs: [], approvals: [{ approvalId: 'ap-1', runId: 'run:a', taskId: null, operation: 'dispatch', policyRevision: 'p1', reasonCode: 'card', rationale: 'Needs a human.', state: 'PENDING', requestedAt: T(9), decidedAt: null, decidedBy: null }],
    contracts: [], transitions: [{ transitionId: 'tr-1', runId: 'run:a', fromState: 'READY', toState: 'EXECUTING', reasonCode: 'dispatch', summary: 'Plan dispatched.', evidenceIds: [], occurredAt: T(5), sequence: 3 }],
    trajectory: [], claims: [], contexts: [{ contextId: 'ctx-1', runId: 'run:a', taskId: 'run:a:plan', workerRole: 'PROMPT_ARCHITECT', compilerVersion: 'julius-context.v1', characterCount: 900, truncated: false, redactionCount: 0, sourceEntryCount: 5, createdAt: T(5) }],
    tasks: [{ taskId: 'run:a:plan', runId: 'run:a', role: 'PROMPT_ARCHITECT', taskType: 'plan', state: 'SUCCEEDED', updatedAt: T(7) }],
    subagents: [],
    records: [
      record({}),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000002', domain: 'REQUIREMENT', status: 'PROPOSED', title: 'Labels sit below their bars.', scope: 'MISSION', runId: 'run:a', updatedAt: T(11) }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000003', domain: 'INSTRUCTION', status: 'WITHDRAWN', title: 'An instruction taken back.', updatedAt: T(12) }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000004', domain: 'MEMORY_REVIEW', status: 'ACCEPTED', title: 'ACCEPTED', subjectRef: 'entry:carried:run:b:brain:decision:x', updatedAt: T(13) }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000005', domain: 'SCRATCHPAD', title: 'a working note', updatedAt: T(14) }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000006', domain: 'SHARED_CONTEXT', title: 'Companions may see the save-format spec.', updatedAt: T(15) }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000007', domain: 'REQUIREMENT', status: 'PROPOSED', title: 'Private to mission B.', scope: 'MISSION', runId: 'run:b', updatedAt: T(16) }),
    ],
    links: [], mutations: [], events: [], slots: [{ runId: 'run:a', role: 'CODING_AGENT', providerId: 'claude', requestedModel: 'claude-opus-5-5', servedModel: null, state: 'NEVER_DISPATCHED' }],
    ...over,
  };
}

describe('the Project Brain document is built from durable rows and nothing else', () => {
  const doc = buildProjectBrainDocument(rows());

  it('has every section, a cursor, and the revision the store counted', () => {
    expect(Object.keys(doc.sections).sort()).toEqual([...PROJECT_BRAIN_SECTIONS].sort());
    expect(doc.cursor).toBe(encodeProjectBrainCursor({ 'run:a': 3 }));
    expect(doc.revision).toBe(7);
    expect(doc.missions.map((m) => [m.runId, m.criteriaSatisfied, m.criteriaTotal, m.openBlockingFindings])).toEqual([['run:a', 1, 1, 1], ['run:b', 0, 0, 0]]);
  });

  it("files Julius's seed entries under the sections they state, stripped of their label", () => {
    expect(doc.sections.objective.find((i) => i.ref === 'entry:run:a:objective')?.text).toBe('Compare three save formats.');
    expect(doc.sections.requirements.find((i) => i.ref === 'entry:run:a:requirement:0')?.text).toBe('Size and load time.');
    expect(doc.sections.constraints.find((i) => i.ref === 'entry:run:a:constraint:0')?.text).toBe('Touch only docs/.');
    expect(doc.sections.research.map((i) => i.ref)).toContain('entry:brain:research-answer:t9');
  });

  it('shows a fact once: a decision from its own table, never also from its context copy', () => {
    const refs = Object.values(doc.sections).flat().map((i) => i.ref);
    expect(refs).not.toContain('entry:brain:decision:run:a:plan:ACCEPT:ok');
    expect(refs).not.toContain('entry:run:a:criteria');
    expect(doc.sections.decisions.map((i) => i.ref)).toContain('decision:d-1');
  });

  it('carries who stated each thing and which channel delivered it, and keeps them apart', () => {
    const finding = doc.sections.findings.find((i) => i.ref === 'finding:f-1')!;
    expect(finding.author).toEqual({ kind: 'INDEPENDENT_REVIEWER', id: 'reviewer-1' });
    expect(finding.deliverer?.kind).toBe('JULIUS_RUNTIME');
    expect(finding.evidenceRefs).toEqual(['evidence:ev-1']);
    expect(finding.subjectRef).toBe('criterion:run:a/AC-1');
    const seed = doc.sections.objective.find((i) => i.ref === 'entry:run:a:objective')!;
    expect(seed.author?.kind).toBe('SYSTEM');
    expect(seed.deliverer?.kind).toBe('RELAY_BOOTSTRAP');
    const proposal = doc.sections.requirements.find((i) => i.ref === 'pbr:00000000-0000-4000-8000-000000000002')!;
    expect(proposal.author).toEqual(PLAYER);
    expect(proposal.deliverer).toEqual({ kind: 'WONDERLAND_CLIENT', id: 'wonderland-session:s1' });
    const evidence = doc.sections.evidence.find((i) => i.ref === 'evidence:ev-1')!;
    expect(evidence.author).toEqual({ kind: 'PROMPT_ARCHITECT', id: 'architect-1' });
  });

  it('evaluations are first-class: criterion, result, evaluator and evidence', () => {
    const evaluation = doc.sections.evals.find((i) => i.ref === 'criterion:run:a/AC-1#eval')!;
    expect(evaluation.attributes).toMatchObject({ criterionId: 'AC-1', result: 'PASSED', evaluator: 'julius:verification' });
    expect(evaluation.evidenceRefs).toEqual(['evidence:ev-1']);
  });

  it('governance shows the policy, the gates and the model topology Julius is under', () => {
    const kinds = doc.sections.governance.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['MISSION_POLICY', 'APPROVAL', 'MODEL_TOPOLOGY']));
    const policy = doc.sections.governance.find((i) => i.ref === 'mission:run:a#policy')!;
    expect(policy.attributes).toMatchObject({ executionMode: 'autonomous', reviewRequirement: 'independent', spendUsd: 2, repairCycles: 1 });
    const model = doc.sections.governance.find((i) => i.kind === 'MODEL_TOPOLOGY')!;
    expect(model.attributes).toMatchObject({ role: 'CODING_AGENT', requestedModel: 'claude-opus-5-5', servedModel: null });
  });
});

describe("Wonderland's existing panel is answered surface by surface", () => {
  const view = projectWonderlandBrainView(buildProjectBrainDocument(rows()));

  it('answers every surface the panel draws, by its id, in its order, with its access', () => {
    expect(view.surfaces.map((s) => [s.id, s.access])).toEqual(PANEL_SURFACES);
    expect(WONDERLAND_BRAIN_SURFACES.length).toBe(29);
  });

  it('carries no sample data: an empty source is an empty surface', () => {
    const empty = projectWonderlandBrainView(buildProjectBrainDocument(rows({
      missions: [], entries: [], criteria: [], findings: [], evidence: [], decisions: [], approvals: [], transitions: [], contexts: [], tasks: [], records: [], slots: [],
    })));
    for (const surface of empty.surfaces) {
      expect(surface.entryCount, surface.id).toBe(0);
      expect(surface.entries, surface.id).toEqual([]);
    }
    expect(empty.sourceLine).not.toMatch(/PREVIEW|SAMPLE/u);
    expect(JSON.stringify(view)).not.toMatch(/DEVELOPMENT PREVIEW|SAMPLE DATA/u);
  });

  it('saved proposals are proposals; withdrawn statements are gone; a review is shown on what it reviews', () => {
    const requirements = view.surfaces.find((s) => s.id === 'requirements')!;
    expect(requirements.proposals.map((p) => p.ref)).toContain('pbr:00000000-0000-4000-8000-000000000002');
    expect(requirements.entries.map((e) => e.ref)).toEqual(expect.arrayContaining(['entry:run:a:requirement:0', 'criterion:run:a/AC-1']));
    expect(view.surfaces.find((s) => s.id === 'instructions')!.entryCount).toBe(0);
    const learned = view.surfaces.find((s) => s.id === 'learned_facts')!;
    expect(learned.entries).toEqual([expect.objectContaining({ ref: 'entry:carried:run:b:brain:decision:x', reviewable: true, review: 'ACCEPTED' })]);
    const auto = view.surfaces.find((s) => s.id === 'auto_memories')!;
    expect(auto.entries.map((e) => e.ref)).toEqual(['entry:brain:research-answer:t9']);
  });

  it('the server, not the client, decides what a proposal on a surface becomes', () => {
    expect(wonderlandProposeDomainFor('requirements')).toBe('REQUIREMENT');
    expect(wonderlandProposeDomainFor('user_facts')).toBe('USER_FACT');
    expect(wonderlandProposeDomainFor('decisions')).toBeNull();
    expect(wonderlandProposeDomainFor('governance')).toBeNull();
    expect(wonderlandProposeDomainFor('anything-else')).toBeNull();
    expect(wonderlandSurfaceIsReviewable('learned_facts')).toBe(true);
    expect(wonderlandSurfaceIsReviewable('requirements')).toBe(false);
  });
});

describe('Julius reads what people stated as what it is: user-stated and unverified', () => {
  const all = rows().records;

  it('reads project-wide statements and this mission\'s own -- never another mission\'s, never a withdrawn one, never a scratchpad', () => {
    const forA = projectBrainContextEntries(all, 'run:a').map((e) => e.entryId);
    expect(forA).toContain('pbr:00000000-0000-4000-8000-000000000002@v1');
    expect(forA).toContain('pbr:00000000-0000-4000-8000-000000000001@v1');
    expect(forA).not.toContain('pbr:00000000-0000-4000-8000-000000000007@v1');
    expect(forA).not.toContain('pbr:00000000-0000-4000-8000-000000000003@v1');
    expect(forA).not.toContain('pbr:00000000-0000-4000-8000-000000000005@v1');
    const forB = projectBrainContextEntries(all, 'run:b').map((e) => e.entryId);
    expect(forB).toContain('pbr:00000000-0000-4000-8000-000000000007@v1');
    expect(forB).not.toContain('pbr:00000000-0000-4000-8000-000000000002@v1');
  });

  it('a proposal says it is one, and qualifies as user_stated / UNVERIFIED / INSTRUCTION -- never a contract term', () => {
    const entries = projectBrainContextEntries(all, 'run:a');
    const proposal = entries.find((e) => e.entryId === 'pbr:00000000-0000-4000-8000-000000000002@v1')!;
    expect(proposal.text).toMatch(/PROJECT BRAIN REQUIREMENT PROPOSED.*\[a proposal, not a term of the contract\]/u);
    const qualification = deriveJuliusContextQualification(entries);
    const claim = qualification.claims.find((c) => c.entryId === proposal.entryId)!;
    expect(claim).toMatchObject({ provenance: 'user_stated', trust: 'UNVERIFIED', assertedBy: 'project-brain:WONDERLAND_PLAYER:player-1' });
    expect(qualification.contextTypes[proposal.entryId]).toBe('INSTRUCTION');
    expect(qualification.contractEntryIds).not.toContain(proposal.entryId);
  });
});

describe('a companion receives one mission and what the project chose to share', () => {
  const doc = buildProjectBrainDocument(rows());

  it('gets that mission\'s terms and open findings, the shared context, and the authority stays Julius\'s', () => {
    const context = projectBrainCompanionContext(doc, 'run:a')!;
    expect(context.authority).toBe('julius_decides');
    expect(context.objective.map((i) => i.ref)).toContain('entry:run:a:objective');
    expect(context.requirements.map((i) => i.ref)).toEqual(expect.arrayContaining(['entry:run:a:requirement:0', 'pbr:00000000-0000-4000-8000-000000000002']));
    expect(context.openFindings.map((i) => i.ref)).toEqual(['finding:f-1']);
    expect(context.sharedContext.map((i) => i.ref)).toEqual(['pbr:00000000-0000-4000-8000-000000000006']);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('Private to mission B.');
    expect(serialized).not.toContain('Wonderland is built in Unreal Engine 5.8.');
    expect(serialized).not.toContain('Needs a human.');
  });

  it('gets nothing for a mission that is not in the document', () => {
    expect(projectBrainCompanionContext(doc, 'run:zzz')).toBeNull();
  });
});
