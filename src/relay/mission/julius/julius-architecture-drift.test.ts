import { describe, expect, it } from 'vitest';

import {
  JULIUS_ARCHITECTURE_DRIFT_LIMITS, JULIUS_ARCHITECTURE_TRIGGERS, JULIUS_CODER_OBSERVATION_KINDS,
  JULIUS_CODER_OBSERVATION_LIMITS, JULIUS_COSMETIC_DRIFT_KINDS, juliusCoderObservationFacts,
  sanitizeJuliusCoderObservations,
  JULIUS_MATERIAL_DRIFT_KINDS, foldJuliusConsistency, juliusArchitectureChangeIsMaterial, juliusArchitectureChanges,
  juliusArchitectureCompletionGate, juliusArchitectureTriggerFacts, juliusArchitectureTriggerId,
  juliusArchitectureTriggers, juliusConsistencyFacts, juliusConsistencyRoute, juliusDriftIsMaterial,
  sanitizeJuliusConsistency,
} from './julius-architecture-drift';
import {
  juliusArchitectureFacts, sanitizeJuliusArchitecture, type JuliusArchitectureState,
} from './julius-architecture-state';
import { validateJuliusEvent } from './julius-events';

/**
 * WHEN JULIUS GOES BACK TO THE ARCHITECT, AND WHAT IT MAY BE TOLD.
 *
 * Every trigger is derived from rows that already exist, so a restart reaches
 * the same answer; every consultation is cause-once and capped; and an
 * assessment that would hold a mission has to name drift that actually matters.
 */

const PROPOSAL = (overrides: Record<string, unknown> = {}) => ({
  components: [{ name: 'normalizer', responsibility: 'Turns a journal page into rows.' }],
  boundaries: [{ name: 'JournalReader', kind: 'INTERFACE', contract: 'peek() may return fewer bytes.', locator: 'src/journal.ts' }],
  dependencies: [{ name: 'pg', assumption: 'Postgres 16 renders NULL as empty.', locator: 'package.json' }],
  decisions: [], assumptions: [{ assumptionId: 'A-1', claim: 'The boundary is a requirement.', state: 'UNVERIFIED', evidenceRefs: [] }],
  openQuestions: [], risks: [],
  ...overrides,
});

const read = (value: unknown, revision = 1): JuliusArchitectureState => {
  const reading = sanitizeJuliusArchitecture({ value, revision, proposedByTaskId: 'plan-1', recordedAt: 't' });
  if (!reading.ok) throw new Error(reading.reasonCode);
  return reading.state;
};
const STATE = read(PROPOSAL());
const row = (type: string, facts: Record<string, string | number | boolean | null>, taskId: string | null = null) =>
  ({ type, facts, taskId });
const RECORDED = row('architecture.recorded', juliusArchitectureFacts(STATE), 'plan-1');

const triggersOf = (entries: readonly ReturnType<typeof row>[], completionReady = false) =>
  juliusArchitectureTriggers({ state: STATE, entries, completionReady });
const kindsOf = (entries: readonly ReturnType<typeof row>[], completionReady = false) =>
  triggersOf(entries, completionReady).map((candidate) => candidate.trigger);

describe('P18 — the seven moments Julius goes back to the architect, each read off the record', () => {
  it('no architecture means no consultation: there is nothing to be consistent with', () => {
    expect(juliusArchitectureTriggers({ state: null, entries: [RECORDED], completionReady: true })).toEqual([]);
  });

  it.each([
    ['IMPLEMENTATION_DRIFT', [row('architecture.conflicted', { revision: 1, kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS', name: 'JournalReader', contractTaskId: 'build-1' })]],
    ['IMPLEMENTATION_DRIFT', [row('finding.recorded', { findingId: 'f1', category: 'contract_drift', blocking: true }, 'build-1')]],
    ['DEPENDENCY_CHANGE', [row('architecture.conflicted', { revision: 1, kind: 'DEPENDENCY_PROHIBITED', name: 'pg', contractTaskId: 'build-1' })]],
    ['CONTRADICTING_EVIDENCE', [row('review.verdict.applied', { verdict: 'WARNING', category: null, contradicts: 'A-1' }, 'build-1')]],
    ['REPAIR_AFFECTS_ARCHITECTURE', [row('review.verdict.applied', { verdict: 'REPAIR_REQUIRED', category: 'unsafe_implementation', reviewsTaskId: 'build-1' }, 'build-1:review')]],
    ['CODER_GUIDANCE_QUESTION', [row('peer.request.opened', {
      requestId: 'q1', kind: 'GUIDANCE_QUESTION', sourceRole: 'CODING_AGENT', targetRole: 'JULIUS',
      status: 'OPEN', requiredResponseType: 'GUIDANCE_PACKET', subjectTaskId: 'build-1',
    })]],
    ['JULIUS_REPLAN_REQUEST', [row('peer.request.opened', {
      requestId: 'r1', kind: 'REPLAN_PROPOSAL', sourceRole: 'PROMPT_ARCHITECT', targetRole: 'JULIUS',
      status: 'OPEN', requiredResponseType: 'REPLAN_DECISION', subjectTaskId: 'plan-1',
    })]],
  ])('%s fires on exactly the row that justifies it', (trigger, entries) => {
    expect(kindsOf([RECORDED, ...entries])).toContain(trigger);
    expect(kindsOf([RECORDED]), 'and on nothing else').toEqual([]);
  });

  it('the pre-completion check fires only when the run is otherwise ready', () => {
    expect(kindsOf([RECORDED], false)).toEqual([]);
    const ready = triggersOf([RECORDED], true);
    expect(ready.map((candidate) => candidate.trigger)).toEqual(['PRE_COMPLETION_CHECK']);
    expect(ready[0]).toMatchObject({ revision: 1, subjectTaskId: null, reasonCode: 'the_run_is_ready_to_complete_and_unchecked' });
    // And the assessment that asks for a re-plan asks for the architect again.
    const replanned = kindsOf([RECORDED, row('architecture.assessed', {
      assessment: 'REPLAN_REQUIRED', revision: 1, claim: 'The persistence model is wrong.', driftKinds: 'PERSISTENCE',
    })]);
    expect(replanned).toContain('JULIUS_REPLAN_REQUEST');
  });

  it('a reviewer cannot invent an assumption to argue with', () => {
    expect(kindsOf([RECORDED, row('review.verdict.applied', { verdict: 'WARNING', contradicts: 'A-9' }, 'build-1')])).toEqual([]);
  });

  it('every trigger in the vocabulary is reachable, and each has one id', () => {
    const all = kindsOf([
      RECORDED,
      row('architecture.conflicted', { revision: 1, kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS', name: 'JournalReader', contractTaskId: 'build-1' }),
      row('architecture.conflicted', { revision: 1, kind: 'DEPENDENCY_PROHIBITED', name: 'pg', contractTaskId: 'build-1' }),
      row('review.verdict.applied', { verdict: 'REPAIR_REQUIRED', category: 'contract_drift', contradicts: 'A-1', reviewsTaskId: 'build-1' }, 'build-1:review'),
      row('peer.request.opened', {
        requestId: 'q1', kind: 'GUIDANCE_QUESTION', sourceRole: 'CODING_AGENT', targetRole: 'JULIUS',
        status: 'OPEN', requiredResponseType: 'GUIDANCE_PACKET', subjectTaskId: 'build-1',
      }),
      row('peer.request.opened', {
        requestId: 'r1', kind: 'REPLAN_PROPOSAL', sourceRole: 'PROMPT_ARCHITECT', targetRole: 'JULIUS',
        status: 'OPEN', requiredResponseType: 'REPLAN_DECISION', subjectTaskId: 'plan-1',
      }),
    ], true);
    expect(new Set(all)).toEqual(new Set(JULIUS_ARCHITECTURE_TRIGGERS));
    expect(juliusArchitectureTriggerId('PRE_COMPLETION_CHECK', 3, null)).toBe('arch:PRE_COMPLETION_CHECK:r3:run');
    expect(juliusArchitectureTriggerId('IMPLEMENTATION_DRIFT', 2, 'build-1')).toBe('arch:IMPLEMENTATION_DRIFT:r2:build-1');
  });
});

describe('P19 — a consultation happens once for its reason, and a run has a ceiling on them', () => {
  it('a trigger already raised is never raised again, however often the cause is re-read', () => {
    const cause = row('finding.recorded', { findingId: 'f1', category: 'contract_drift' }, 'build-1');
    const first = triggersOf([RECORDED, cause]);
    expect(first).toHaveLength(1);
    const served = row('architecture.trigger.raised', juliusArchitectureTriggerFacts(first[0]!));
    expect(triggersOf([RECORDED, cause, served]), 'cause-once').toEqual([]);
    // Including on a resume, where the same rows are read again from the start.
    expect(triggersOf([RECORDED, cause, served, cause])).toEqual([]);
  });

  it('a run that keeps drifting still stops consulting: the cap is a number, not a hope', () => {
    const raised = Array.from({ length: JULIUS_ARCHITECTURE_DRIFT_LIMITS.consultations }, (_, index) =>
      row('architecture.trigger.raised', { triggerId: `arch:IMPLEMENTATION_DRIFT:r1:task-${String(index)}`, trigger: 'IMPLEMENTATION_DRIFT', revision: 1 }));
    const findings = Array.from({ length: 40 }, (_, index) =>
      row('finding.recorded', { findingId: `f${String(index)}`, category: 'contract_drift' }, `other-${String(index)}`));
    expect(triggersOf([RECORDED, ...raised, ...findings], true)).toEqual([]);
    // One below the cap, exactly one more is offered.
    expect(triggersOf([RECORDED, ...raised.slice(1), ...findings], true)).toHaveLength(1);
  });

  it('a revision of its own is a new reason to ask: the id carries the revision', () => {
    const second = read(PROPOSAL(), 2);
    const cause = row('finding.recorded', { findingId: 'f1', category: 'contract_drift' }, 'build-1');
    const served = row('architecture.trigger.raised', { triggerId: 'arch:IMPLEMENTATION_DRIFT:r1:build-1', trigger: 'IMPLEMENTATION_DRIFT', revision: 1 });
    const later = juliusArchitectureTriggers({ state: second, entries: [RECORDED, cause, served], completionReady: false });
    expect(later.map((candidate) => candidate.triggerId)).toEqual(['arch:IMPLEMENTATION_DRIFT:r2:build-1']);
  });
});

describe('P20 — material is a list, not a feeling', () => {
  it('every boundary kind is material and every cosmetic kind is not', () => {
    for (const kind of JULIUS_MATERIAL_DRIFT_KINDS) expect(juliusDriftIsMaterial(kind), kind).toBe(true);
    for (const kind of JULIUS_COSMETIC_DRIFT_KINDS) expect(juliusDriftIsMaterial(kind), kind).toBe(false);
    expect(juliusDriftIsMaterial('VIBES')).toBe(false);
  });

  it('a revision that moves a boundary, a dependency or an owner is material; one that rewords is not', () => {
    const before = read(PROPOSAL());
    expect(juliusArchitectureChanges(null, before), 'a first revision changes nothing: there was nothing').toEqual([]);

    const reworded = read(PROPOSAL(), 2);
    expect(juliusArchitectureChanges(before, reworded)).toEqual([]);
    expect(juliusArchitectureChangeIsMaterial(juliusArchitectureChanges(before, reworded))).toBe(false);

    const moved = read(PROPOSAL({
      boundaries: [{ name: 'JournalReader', kind: 'SCHEMA', contract: 'rows are fixed width now', locator: 'src/journal.ts' }],
      dependencies: [],
      components: [{ name: 'normalizer', responsibility: 'Streams instead.' }, { name: 'writer', responsibility: 'Writes rows.' }],
    }), 2);
    expect(juliusArchitectureChanges(before, moved)).toEqual([
      { kind: 'SCHEMA', name: 'JournalReader', change: 'CHANGED', material: true },
      { kind: 'DEPENDENCY', name: 'pg', change: 'REMOVED', material: true },
      { kind: 'OWNERSHIP', name: 'normalizer', change: 'CHANGED', material: true },
      { kind: 'OWNERSHIP', name: 'writer', change: 'ADDED', material: true },
    ]);
    expect(juliusArchitectureChangeIsMaterial(juliusArchitectureChanges(before, moved))).toBe(true);
  });
});

describe('P21 — the assessment is an assessment, and it has to be earned', () => {
  const assessment = (overrides: Record<string, unknown>) => sanitizeJuliusConsistency({
    value: {
      assessment: 'ALIGNED', claim: 'What was built matches the design.', drift: [], driftingTaskIds: [], evidenceRefs: [],
      ...overrides,
    },
    revision: 4,
  });

  it('reads a clean answer, and says what Julius does with it', () => {
    const reading = assessment({});
    expect(reading).toMatchObject({ ok: true, declaration: { assessment: 'ALIGNED', revision: 4, drift: [] } });
    expect(juliusConsistencyRoute('ALIGNED')).toBe('PROCEED');
    expect(juliusConsistencyRoute('DRIFT_NON_BLOCKING')).toBe('RECORD');
    expect(juliusConsistencyRoute('DRIFT_REQUIRES_REPAIR')).toBe('REPAIR');
    expect(juliusConsistencyRoute('REPLAN_REQUIRED')).toBe('REPLAN');
  });

  it.each([
    ['a mission-owned term', { acceptanceCriteria: [] }, 'peer_response_mutates_protected_term'],
    ['a minted completion', { status: 'VERIFIED' }, 'peer_response_mints_julius_only_outcome'],
    ['an invented assessment', { assessment: 'PROBABLY_FINE' }, 'consistency_assessment_unknown'],
    ['aligned beside a list of drift', { drift: [{ kind: 'SCHEMA', name: 'rows', claim: 'it moved' }], evidenceRefs: ['x'] }, 'consistency_aligned_with_drift'],
    ['drift claimed with nothing named', { assessment: 'DRIFT_NON_BLOCKING' }, 'consistency_drift_unstated'],
    ['drift named with nothing cited', { assessment: 'DRIFT_NON_BLOCKING', drift: [{ kind: 'NAMING', name: 'x', claim: 'renamed' }] }, 'consistency_drift_unevidenced'],
    ['a repair demanded for a rename', {
      assessment: 'DRIFT_REQUIRES_REPAIR', drift: [{ kind: 'NAMING', name: 'x', claim: 'renamed' }],
      evidenceRefs: ['src/x.ts:1'], driftingTaskIds: ['build-1'],
    }, 'consistency_drift_immaterial'],
    ['a re-plan demanded for a comment', {
      assessment: 'REPLAN_REQUIRED', drift: [{ kind: 'COMMENT', name: 'x', claim: 'reworded' }], evidenceRefs: ['src/x.ts:1'],
    }, 'consistency_drift_immaterial'],
    ['a repair that names no work', {
      assessment: 'DRIFT_REQUIRES_REPAIR', drift: [{ kind: 'SCHEMA', name: 'rows', claim: 'it moved' }], evidenceRefs: ['src/x.ts:1'],
    }, 'consistency_repair_names_no_work'],
    ['an unreadable drift kind', { assessment: 'DRIFT_NON_BLOCKING', drift: [{ kind: 'VIBES', name: 'x', claim: 'y' }], evidenceRefs: ['z'] }, 'consistency_drift_invalid'],
    ['a credential-shaped claim', { claim: 'token: abc123' }, 'consistency_claim_invalid'],
    ['a task id that is not one', { assessment: 'DRIFT_REQUIRES_REPAIR', drift: [{ kind: 'SCHEMA', name: 'r', claim: 'c' }], evidenceRefs: ['e'], driftingTaskIds: ['../../etc'] }, 'consistency_drifting_tasks_invalid'],
  ])('refuses %s by name', (_label, overrides, reasonCode) => {
    expect(assessment(overrides)).toEqual({ ok: false, reasonCode });
  });

  it('a blocking answer that IS material and IS evidenced is admitted, and says what it holds', () => {
    const reading = assessment({
      assessment: 'DRIFT_REQUIRES_REPAIR',
      claim: 'The rows are fixed width and the reader still assumes variable.',
      drift: [{ kind: 'SCHEMA', name: 'JournalRow', claim: 'Fixed width now.' }, { kind: 'NAMING', name: 'reader', claim: 'renamed too' }],
      driftingTaskIds: ['build-1'], evidenceRefs: ['src/journal.ts:120'],
    });
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    const facts = juliusConsistencyFacts(reading.declaration);
    expect(facts).toMatchObject({
      assessment: 'DRIFT_REQUIRES_REPAIR', route: 'REPAIR', revision: 4, drift: 2, materialDrift: 1,
      driftKinds: 'SCHEMA NAMING', driftingTaskIds: 'build-1',
    });
    expect(() => validateJuliusEvent({
      eventId: 'e', runId: 'r', projectId: 'p', type: 'architecture.assessed', taskId: 't', workerId: 'w',
      correlationId: 'c', causationId: null, occurredAt: 't', facts: { ...facts, owner: 'o' },
    })).not.toThrow();
  });
});

describe('P22 — the completion gate can only hold, and it is honest about what it does not know', () => {
  const assessed = (assessment: string, revision = 1) =>
    row('architecture.assessed', { assessment, revision, claim: 'c', driftKinds: 'SCHEMA', driftingTaskIds: 'build-1', evidenceRefs: 'e' });

  it('a run that recorded no architecture is not held', () => {
    expect(juliusArchitectureCompletionGate({ entries: [] })).toEqual({ ok: true, reasonCode: 'NO_ARCHITECTURE_RECORDED' });
  });

  it('an unanswered revision holds, and an answer about an older one is not an answer about this one', () => {
    expect(juliusArchitectureCompletionGate({ entries: [RECORDED] })).toEqual({ ok: false, reasonCode: 'ARCHITECTURE_CHECK_PENDING' });
    const second = read(PROPOSAL(), 2);
    expect(juliusArchitectureCompletionGate({
      entries: [RECORDED, assessed('ALIGNED', 1), row('architecture.recorded', juliusArchitectureFacts(second))],
    })).toEqual({ ok: false, reasonCode: 'ARCHITECTURE_CHECK_PENDING' });
  });

  it.each([
    ['ALIGNED', true, 'ARCHITECTURE_ALIGNED'],
    ['DRIFT_NON_BLOCKING', true, 'ARCHITECTURE_DRIFT_ACCEPTED'],
    ['DRIFT_REQUIRES_REPAIR', false, 'ARCHITECTURE_DRIFT_REQUIRES_REPAIR'],
    ['REPLAN_REQUIRED', false, 'ARCHITECTURE_REPLAN_REQUIRED'],
  ])('%s decides the gate and says why', (assessment, ok, reasonCode) => {
    expect(juliusArchitectureCompletionGate({ entries: [RECORDED, assessed(assessment)] })).toEqual({ ok, reasonCode });
  });

  it('a consultation no worker could serve does not strand the mission', () => {
    const unserved = row('architecture.trigger.raised', {
      trigger: 'PRE_COMPLETION_CHECK', triggerId: 'arch:PRE_COMPLETION_CHECK:r1:run', revision: 1,
      served: false, servedByTaskId: null, unroutable: true,
    });
    expect(juliusArchitectureCompletionGate({ entries: [RECORDED, unserved] }))
      .toEqual({ ok: true, reasonCode: 'ARCHITECTURE_CHECK_UNROUTABLE' });
    // But one that WAS served still owes an answer.
    const served = row('architecture.trigger.raised', {
      trigger: 'PRE_COMPLETION_CHECK', triggerId: 'arch:PRE_COMPLETION_CHECK:r1:run', revision: 1,
      served: true, servedByTaskId: 'architecture:x:task', unroutable: false,
    });
    expect(juliusArchitectureCompletionGate({ entries: [RECORDED, served] }))
      .toEqual({ ok: false, reasonCode: 'ARCHITECTURE_CHECK_PENDING' });
  });

  it('the latest assessment is the one that counts, and a row it cannot read is ignored', () => {
    const entries = [RECORDED, assessed('DRIFT_REQUIRES_REPAIR'), assessed('ALIGNED'), row('architecture.assessed', { assessment: 'FINE', revision: 1, claim: 'c' })];
    expect(foldJuliusConsistency(entries)!.assessment).toBe('ALIGNED');
    expect(juliusArchitectureCompletionGate({ entries })).toEqual({ ok: true, reasonCode: 'ARCHITECTURE_ALIGNED' });
    expect(foldJuliusConsistency([])).toBeNull();
    // Through JSON, exactly as a restart would read them.
    expect(foldJuliusConsistency(JSON.parse(JSON.stringify(entries)))!.assessment).toBe('ALIGNED');
  });
});

describe('P26 — what the implementation peer saw can reach the architect, and never the architecture', () => {
  const observed = (kind: string, subject = 'A-1', taskId = 'build-1', revision = 1) =>
    row('architecture.observed', {
      revision, kind, subject, claim: 'It did not hold.', evidenceRefs: 'src/journal.ts:40', evidenceRefCount: 1, observedByRole: 'CODING_AGENT',
    }, taskId);

  it.each([
    ['ASSUMPTION_INVALIDATED', 'CONTRADICTING_EVIDENCE'],
    ['DEPENDENCY_CHANGED', 'DEPENDENCY_CHANGE'],
    ['BOUNDARY_CROSSED', 'IMPLEMENTATION_DRIFT'],
    ['ARCHITECTURE_UNSATISFIABLE', 'JULIUS_REPLAN_REQUEST'],
    ['REPLAN_SUGGESTED', 'JULIUS_REPLAN_REQUEST'],
  ])('%s raises %s, about the work that saw it', (kind, trigger) => {
    expect(triggersOf([RECORDED, observed(kind)])).toEqual([{
      trigger, triggerId: juliusArchitectureTriggerId(trigger as never, 1, 'build-1'), revision: 1,
      subjectTaskId: 'build-1', reasonCode: `coder_observed_${kind.toLowerCase()}`, detail: 'A-1',
    }]);
  });

  it('every kind a coder may name reaches a trigger that exists, and the kinds are exactly these', () => {
    expect([...JULIUS_CODER_OBSERVATION_KINDS]).toEqual([
      'ASSUMPTION_INVALIDATED', 'DEPENDENCY_CHANGED', 'BOUNDARY_CROSSED', 'ARCHITECTURE_UNSATISFIABLE', 'REPLAN_SUGGESTED',
    ]);
    for (const kind of JULIUS_CODER_OBSERVATION_KINDS) {
      const candidates = triggersOf([RECORDED, observed(kind)]);
      expect(candidates).toHaveLength(1);
      expect(JULIUS_ARCHITECTURE_TRIGGERS).toContain(candidates[0]!.trigger);
    }
  });

  it('an observation about a design no longer in force, or of a kind nobody defined, raises nothing', () => {
    expect(triggersOf([RECORDED, observed('BOUNDARY_CROSSED', 'JournalReader', 'build-1', 0)])).toEqual([]);
    expect(triggersOf([RECORDED, observed('BOUNDARY_CROSSED', 'JournalReader', 'build-1', 2)])).toEqual([]);
    expect(triggersOf([RECORDED, observed('REWRITE_THE_ARCHITECTURE')])).toEqual([]);
    expect(triggersOf([RECORDED, row('architecture.observed', { revision: 1, subject: 'A-1' }, 'build-1')])).toEqual([]);
  });

  it('cause-once: the same work saying the same thing twice consults once; other work saying it consults again', () => {
    expect(triggersOf([RECORDED, observed('BOUNDARY_CROSSED'), observed('BOUNDARY_CROSSED', 'Other')])).toHaveLength(1);
    expect(triggersOf([RECORDED, observed('BOUNDARY_CROSSED'), observed('BOUNDARY_CROSSED', 'A-1', 'repair:build-1:1:task')])).toHaveLength(2);
    const id = juliusArchitectureTriggerId('IMPLEMENTATION_DRIFT', 1, 'build-1');
    expect(triggersOf([RECORDED, row('architecture.trigger.raised', { triggerId: id }), observed('BOUNDARY_CROSSED')])).toEqual([]);
  });

  const OBSERVATION = { kind: 'ASSUMPTION_INVALIDATED', subject: 'A-1', claim: 'peek() returned a full page on every read.', evidenceRefs: ['src/journal.ts:40'] };
  const sanitize = (value: unknown, state: JuliusArchitectureState | null = STATE) => sanitizeJuliusCoderObservations({ value, state });

  it('reads an evidenced observation, and normalises only what cannot change its meaning', () => {
    const reading = sanitize([
      { ...OBSERVATION, kind: ' assumption_invalidated ', evidenceRefs: ['src/journal.ts:40', 'src/journal.ts:40'] },
      { kind: 'DEPENDENCY_CHANGED', subject: 'pg', claim: 'NULL renders as the literal word.', evidenceRefs: ['test/output.txt:12', 'package.json'] },
    ]);
    expect(reading).toEqual({
      ok: true,
      observations: [
        OBSERVATION,
        { kind: 'DEPENDENCY_CHANGED', subject: 'pg', claim: 'NULL renders as the literal word.', evidenceRefs: ['test/output.txt:12', 'package.json'] },
      ],
    });
    expect(JSON.parse(JSON.stringify(reading))).toEqual(reading);
  });

  it.each([
    ['a mission term', [{ ...OBSERVATION, permittedPaths: ['src/'] }], 'peer_response_mutates_protected_term'],
    ['a Julius-only outcome', [{ ...OBSERVATION, status: 'VERIFIED' }], 'peer_response_mints_julius_only_outcome'],
    ['not a list', OBSERVATION, 'coder_observations_shape_refused'],
    ['an empty list', [], 'coder_observations_shape_refused'],
    ['too many', Array.from({ length: JULIUS_CODER_OBSERVATION_LIMITS.observations + 1 }, () => OBSERVATION), 'coder_observations_shape_refused'],
    ['a bare string', ['the design is wrong'], 'coder_observations_shape_refused'],
    ['an architecture smuggled in', [{ ...OBSERVATION, components: [{ name: 'x', responsibility: 'y' }] }], 'coder_observations_unknown_field'],
    ['a revision smuggled in', [{ ...OBSERVATION, revision: 2 }], 'coder_observations_unknown_field'],
    ['an unknown kind', [{ ...OBSERVATION, kind: 'REVISE_ARCHITECTURE' }], 'coder_observation_kind_unknown'],
    ['an empty claim', [{ ...OBSERVATION, claim: '   ' }], 'coder_observation_text_invalid'],
    ['a credential-shaped claim', [{ ...OBSERVATION, claim: 'api_key=abc123 was needed' }], 'coder_observation_text_invalid'],
    ['an oversized subject', [{ ...OBSERVATION, kind: 'BOUNDARY_CROSSED', subject: 'x'.repeat(JULIUS_CODER_OBSERVATION_LIMITS.subjectChars + 1) }], 'coder_observation_text_invalid'],
    ['no evidence', [{ ...OBSERVATION, evidenceRefs: [] }], 'coder_observation_unevidenced'],
    ['evidence that is not a list', [{ ...OBSERVATION, evidenceRefs: 'src/journal.ts:40' }], 'coder_observation_unevidenced'],
    ['too much evidence', [{ ...OBSERVATION, evidenceRefs: ['a', 'b', 'c', 'd', 'e'] }], 'coder_observation_unevidenced'],
    ['an empty locator', [{ ...OBSERVATION, evidenceRefs: [''] }], 'coder_observation_unevidenced'],
    ['an assumption the design never made', [{ ...OBSERVATION, subject: 'A-9' }], 'coder_observation_names_unknown_assumption'],
  ])('refuses %s, by name', (_label, value, reasonCode) => {
    expect(sanitize(value)).toEqual({ ok: false, reasonCode });
  });

  it('an observation with no design in force is refused: there is nothing it can be about', () => {
    expect(sanitize([OBSERVATION], null)).toEqual({ ok: false, reasonCode: 'coder_observations_without_architecture' });
  });

  it('the row it becomes is a valid event, and its locators split back exactly', () => {
    const reading = sanitize([{ ...OBSERVATION, evidenceRefs: ['src/journal.ts:40', 'the suite output, line 12'] }]);
    if (!reading.ok) throw new Error(reading.reasonCode);
    const facts = juliusCoderObservationFacts({ observation: reading.observations[0]!, revision: 1, observedByRole: 'CODING_AGENT' });
    expect(facts).toEqual({
      revision: 1, kind: 'ASSUMPTION_INVALIDATED', subject: 'A-1', claim: OBSERVATION.claim,
      evidenceRefs: 'src/journal.ts:40\nthe suite output, line 12', evidenceRefCount: 2, observedByRole: 'CODING_AGENT',
    });
    expect(String(facts.evidenceRefs).split('\n')).toEqual(['src/journal.ts:40', 'the suite output, line 12']);
    for (const type of ['architecture.observed', 'architecture.observation.refused']) {
      expect(() => validateJuliusEvent({
        eventId: 'e', runId: 'r', projectId: 'p', type: type as never, taskId: 'build-1', workerId: 'w',
        correlationId: 'c', causationId: null, occurredAt: 't', facts,
      })).not.toThrow();
    }
  });
});
