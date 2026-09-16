import { describe, expect, it } from 'vitest';

import {
  JULIUS_ARCHITECTURE_LIMITS, JULIUS_BOUNDARY_KINDS,
  foldJuliusArchitecture, juliusArchitectureConflicts, juliusArchitectureFacts, juliusNextArchitectureRevision,
  renderJuliusArchitecture, sanitizeJuliusArchitecture,
  type JuliusArchitectureState,
} from './julius-architecture-state';
import { validateJuliusEvent } from './julius-events';

/** The architecture as state: what it may say, what it may never say, and how it comes back. */

const PROPOSAL = () => ({
  components: [{ name: 'normalizer', responsibility: 'Turns a journal page into rows.' }],
  boundaries: [{
    name: 'JournalReader', kind: 'interface', contract: 'peek() may return fewer bytes than asked.',
    locator: 'src/relay/persistence/journal.ts',
  }],
  dependencies: [{ name: 'pg', assumption: 'Postgres 16 renders NULL as an empty field under -A.', locator: 'package.json' }],
  decisions: [{
    decisionId: 'D-1', decision: 'Reuse the journal reader.', reason: 'A second buffer double-buffers the same page.',
    rejectedAlternatives: ['Add a second buffer'], evidenceRefs: ['src/relay/persistence/journal.ts:120'],
  }],
  assumptions: [{ assumptionId: 'A-1', claim: 'The 8KiB boundary is a requirement.', state: 'unverified', evidenceRefs: [] }],
  openQuestions: [{ questionId: 'Q-1', question: 'Is 8KiB a requirement or an accident?', owner: 'PROMPT_ARCHITECT', blocking: false }],
  risks: [{ riskId: 'R-1', risk: 'A partial read is treated as EOF.', impact: 'high', mitigation: 'Assert the byte count in the test.' }],
});

const read = (value: unknown, revision = 1): JuliusArchitectureState => {
  const reading = sanitizeJuliusArchitecture({ value, revision, proposedByTaskId: 'plan-1', recordedAt: '2026-09-16T00:00:00.000Z' });
  if (!reading.ok) throw new Error(reading.reasonCode);
  return reading.state;
};

describe('a revision is rebuilt from an allowlist', () => {
  it('keeps every field Julius reads, normalised', () => {
    const state = read(PROPOSAL());
    expect(state).toMatchObject({
      version: 'julius-architecture-state.v1', revision: 1, proposedByTaskId: 'plan-1',
      components: [{ name: 'normalizer' }],
      boundaries: [{ name: 'JournalReader', kind: 'INTERFACE', locator: 'src/relay/persistence/journal.ts' }],
      assumptions: [{ assumptionId: 'A-1', state: 'UNVERIFIED' }],
      risks: [{ riskId: 'R-1', impact: 'HIGH' }],
    });
    expect(state.decisions[0]!.rejectedAlternatives, 'what was turned down is kept').toEqual(['Add a second buffer']);
  });

  it.each([
    ['a mission-owned term', { ...PROPOSAL(), acceptanceCriteria: [] }, 'peer_response_mutates_protected_term'],
    ['a completion claim', { ...PROPOSAL(), status: 'VERIFIED' }, 'peer_response_mints_julius_only_outcome'],
    ['a budget, nested', { ...PROPOSAL(), components: [{ name: 'x', responsibility: 'y', budget: 5 }] }, 'peer_response_mutates_protected_term'],
    ['an invented boundary kind', { ...PROPOSAL(), boundaries: [{ name: 'x', kind: 'VIBES', contract: 'y' }] }, 'architecture_shape_refused'],
    ['an unreadable assumption state', { ...PROPOSAL(), assumptions: [{ assumptionId: 'A-1', claim: 'c', state: 'MAYBE' }] }, 'architecture_shape_refused'],
    ['a question with no owner', { ...PROPOSAL(), openQuestions: [{ questionId: 'Q-1', question: 'q', blocking: true }] }, 'architecture_shape_refused'],
    ['a credential-shaped claim', { ...PROPOSAL(), components: [{ name: 'x', responsibility: 'token: abc' }] }, 'architecture_shape_refused'],
    ['nothing at all', { assumptions: [], risks: [] }, 'architecture_empty'],
    ['not an object', 'an architecture', 'architecture_shape_refused'],
  ])('refuses %s by name', (_label, value, reasonCode) => {
    expect(sanitizeJuliusArchitecture({ value, revision: 1, proposedByTaskId: 'plan-1', recordedAt: 't' }))
      .toEqual({ ok: false, reasonCode });
  });

  it('refuses a revision too large to carry, rather than truncating it into a half picture', () => {
    const wide = {
      ...PROPOSAL(),
      components: Array.from({ length: JULIUS_ARCHITECTURE_LIMITS.components }, (_, index) => ({
        name: `component-${String(index)}`, responsibility: 'r'.repeat(JULIUS_ARCHITECTURE_LIMITS.textChars),
      })),
      boundaries: Array.from({ length: JULIUS_ARCHITECTURE_LIMITS.boundaries }, (_, index) => ({
        name: `boundary-${String(index)}`, kind: 'SCHEMA', contract: 'c'.repeat(JULIUS_ARCHITECTURE_LIMITS.textChars),
      })),
    };
    expect(sanitizeJuliusArchitecture({ value: wide, revision: 1, proposedByTaskId: 'plan-1', recordedAt: 't' }))
      .toEqual({ ok: false, reasonCode: 'architecture_too_large' });
    // And one over a collection's own cap is refused too.
    expect(sanitizeJuliusArchitecture({
      value: { ...PROPOSAL(), risks: Array.from({ length: 13 }, () => ({ riskId: 'R', risk: 'r', impact: 'LOW', mitigation: 'm' })) },
      revision: 1, proposedByTaskId: 'plan-1', recordedAt: 't',
    })).toEqual({ ok: false, reasonCode: 'architecture_shape_refused' });
  });

  it('every boundary kind the vocabulary names is admitted, and nothing else is', () => {
    for (const kind of JULIUS_BOUNDARY_KINDS) {
      expect(read({ ...PROPOSAL(), boundaries: [{ name: 'b', kind, contract: 'c' }] }).boundaries[0]!.kind).toBe(kind);
    }
  });
});

describe('the contract wins where they disagree', () => {
  it('records a boundary outside the permitted paths and a prohibited dependency, and changes neither', () => {
    const state = read(PROPOSAL());
    const conflicts = juliusArchitectureConflicts(state, {
      permittedPaths: ['src/relay/mission/'], prohibitedActions: ['adding a pg dependency'],
    });
    expect(conflicts).toEqual([
      { kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS', name: 'JournalReader', detail: 'src/relay/persistence/journal.ts' },
      { kind: 'DEPENDENCY_PROHIBITED', name: 'pg', detail: 'adding a pg dependency' },
    ]);
  });

  it('finds nothing to report when the design stays inside the agreement, or when there is no contract to compare', () => {
    const state = read(PROPOSAL());
    expect(juliusArchitectureConflicts(state, { permittedPaths: ['src/relay/'], prohibitedActions: [] })).toEqual([]);
    expect(juliusArchitectureConflicts(state, null)).toEqual([]);
  });
});

describe('the accepted architecture comes back from the rows alone', () => {
  const first = read(PROPOSAL(), 1);
  const second = read({ ...PROPOSAL(), components: [{ name: 'normalizer', responsibility: 'Now streams instead.' }] }, 2);
  const rows = [
    { type: 'architecture.recorded', facts: juliusArchitectureFacts(first) },
    { type: 'architecture.recorded', facts: juliusArchitectureFacts(second) },
  ];

  it('the highest revision is the one in force, through JSON', () => {
    expect(foldJuliusArchitecture(rows)).toEqual(second);
    expect(foldJuliusArchitecture(JSON.parse(JSON.stringify(rows)))).toEqual(second);
    expect(juliusNextArchitectureRevision(rows)).toBe(3);
    expect(juliusNextArchitectureRevision([])).toBe(1);
    // A PROPOSED revision nobody accepted still USED its number: handing that
    // number to the next proposal would put two pictures on one row id.
    const proposed = [...rows, { type: 'architecture.recorded', facts: { ...juliusArchitectureFacts(second), revision: 3, status: 'PROPOSED' } }];
    expect(foldJuliusArchitecture(proposed), 'and it governs nothing').toEqual(second);
    expect(juliusNextArchitectureRevision(proposed)).toBe(4);
    expect(foldJuliusArchitecture([])).toBeNull();
  });

  it('a row that would not pass the allowlist today is ignored rather than trusted', () => {
    // Written by an older build, restored from a backup, or edited by hand.
    const tampered = [
      ...rows,
      { type: 'architecture.recorded', facts: { ...juliusArchitectureFacts(second), revision: 9, state: JSON.stringify({ ...second, acceptanceCriteria: [] }) } },
      { type: 'architecture.recorded', facts: { ...juliusArchitectureFacts(second), revision: 10, state: '{not json' } },
    ];
    expect(foldJuliusArchitecture(tampered), 'the last good revision still stands').toEqual(second);
  });

  it('the row fits the event validator, and the rendering names what a worker must respect', () => {
    const facts = juliusArchitectureFacts(second);
    expect(() => validateJuliusEvent({
      eventId: 'e', runId: 'r', projectId: 'p', type: 'architecture.recorded', taskId: null, workerId: null,
      correlationId: 'c', causationId: null, occurredAt: 't', facts: { ...facts, owner: 'o' },
    })).not.toThrow();
    const rendered = renderJuliusArchitecture(second);
    expect(rendered).toContain('advisory mission state. The Mission Contract remains authoritative');
    expect(rendered).toContain('[INTERFACE] JournalReader');
    expect(rendered).toContain('D-1');
    expect(rendered).toContain('rejected: Add a second buffer');
    expect(rendered).toContain('A-1 [UNVERIFIED]');
  });
});
