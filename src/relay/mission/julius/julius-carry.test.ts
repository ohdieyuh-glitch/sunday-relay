import { describe, expect, it } from 'vitest';

import { juliusArchitectureEntryId, juliusArchitectureProposalEntryId } from './julius-architecture-state';
import {
  JULIUS_CARRY_CLAIM_CHARS, JULIUS_CARRY_EXCLUSION_CODES, JULIUS_CARRY_LIMIT, JULIUS_CARRY_VERSION,
  isJuliusCarriedEntryId, juliusCarriedIdsIn, juliusCarryEntryId, juliusCarryManifestFacts, juliusCarryPairGate,
  juliusCarryReceipt, selectJuliusCarry,
  type JuliusCarryClaimCandidate, type JuliusCarrySourceRun,
} from './julius-carry';
import { juliusClaimIdFor } from './julius-claim-ledger';
import { juliusFindingTransitionFacts, type JuliusFindingMove } from './julius-finding-lifecycle';
import type { JuliusMemoryClaim } from './julius-memory-trust';
import type { JuliusPeerLedgerEntry } from './julius-peer-channel';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE CORRECTED CARRY, HELD TO DECISION C's RULES.
 *
 *   - only verified reviewer findings and adopted, in-force decisions travel;
 *   - every other thing the first carry took is excluded BY NAME;
 *   - scope and provenance survive the copy;
 *   - a WITH arm with no verified repair finding is not a valid arm;
 *   - what the planner received is read off its packet, not assumed.
 */

const TARGET = 'run:with-1';
const SOURCE = 'run:without-1';

const finding = (over: Partial<JuliusReviewerFinding> = {}): JuliusReviewerFinding => ({
  findingId: 'f-1', runId: SOURCE, taskId: `${SOURCE}:build`, reviewerWorkerId: 'reviewer-hermes',
  severity: 'HIGH', category: 'correctness', claim: 'parseDate accepts 2026-02-30 and returns March 2nd.',
  criterionId: 'AC-2', evidenceIds: ['evidence:review-1'], blocking: true, status: 'OPEN',
  createdAt: '2026-10-01T10:00:00.000Z', ...over,
});

const recorded = (findingId: string, reviewTaskId: string): JuliusPeerLedgerEntry =>
  ({ type: 'finding.recorded', facts: { findingId, reviewTaskId }, taskId: reviewTaskId });

const moved = (findingId: string, move: JuliusFindingMove, ids: { review?: string; repair?: string; by?: string } = {}): JuliusPeerLedgerEntry => ({
  type: 'finding.transitioned',
  taskId: null,
  facts: juliusFindingTransitionFacts({
    findingId, move, at: '2026-10-01T11:00:00.000Z',
    reviewTaskId: ids.review ?? null, repairTaskId: ids.repair ?? null, supersededByFindingId: ids.by ?? null,
  }),
});

/** A finding raised by a review, repaired, and resolved by the re-review: the thing a pair exists to move. */
const repairedLife = (findingId: string): JuliusPeerLedgerEntry[] => [
  recorded(findingId, `${SOURCE}:review`),
  moved(findingId, 'REPAIR_SUCCEEDED', { repair: `${SOURCE}:repair-1` }),
  moved(findingId, 'REVIEWER_RESOLVED', { review: `${SOURCE}:review:repair-1` }),
];

const source = (findings: JuliusReviewerFinding[], ledger: JuliusPeerLedgerEntry[], runId = SOURCE): JuliusCarrySourceRun =>
  ({ runId, findings, ledger });

const claim = (over: Partial<JuliusMemoryClaim> = {}): JuliusMemoryClaim => ({
  claimId: 'claim:e', entryId: 'e', provenance: 'reviewer_verified', trust: 'VERIFIED', assertedBy: 'coder',
  assertedAt: '2026-10-01T09:00:00.000Z', evidence: [{ kind: 'REVIEW', id: 'review-1' }], supersedes: null, contradicts: [],
  ...over,
});

const candidate = (
  entryId: string,
  kind: JuliusCarryClaimCandidate['entry']['kind'],
  taskId: string | null | undefined,
  over: Partial<JuliusMemoryClaim> = {},
): JuliusCarryClaimCandidate => ({
  sourceRunId: SOURCE,
  taskId,
  claim: claim({ claimId: juliusClaimIdFor(entryId), entryId, ...over }),
  entry: { entryId, kind, text: `text of ${entryId}`, evidenceIds: ['evidence:x'] },
});

describe('what carries: verified reviewer findings', () => {
  it('a finding raised by a review, repaired, and resolved by the re-review carries as a VERIFIED_REPAIR_FINDING', () => {
    const selection = selectJuliusCarry({ targetRunId: TARGET, sources: [source([finding()], repairedLife('f-1'))], claims: [] });
    expect(selection.version).toBe(JULIUS_CARRY_VERSION);
    expect(selection.excluded).toEqual([]);
    expect(selection.selected).toHaveLength(1);
    const item = selection.selected[0]!;
    expect(item.carryClass).toBe('VERIFIED_REPAIR_FINDING');
    expect(item.entryId).toBe(juliusCarryEntryId(SOURCE, 'finding:f-1'));
    expect(item.storedKind).toBe('FINDING');
    expect(selection.counts).toEqual({ VERIFIED_REPAIR_FINDING: 1, VERIFIED_FINDING: 0, ACCEPTED_DECISION: 0 });
  });

  it('keeps the whole provenance: source run, the work, the raising review, the repairs and the resolving review', () => {
    const item = selectJuliusCarry({ targetRunId: TARGET, sources: [source([finding()], repairedLife('f-1'))], claims: [] }).selected[0]!;
    expect(item.scope).toEqual({
      sourceRunId: SOURCE, sourceRef: 'finding:f-1', sourceTaskId: `${SOURCE}:build`,
      originReviewTaskId: `${SOURCE}:review`, repairTaskIds: [`${SOURCE}:repair-1`],
      resolutionReviewTaskId: `${SOURCE}:review:repair-1`, criterionId: 'AC-2',
    });
    // The text says it is a PRIOR lesson from another mission, and names where from.
    expect(item.text).toMatch(/^PRIOR VERIFIED REPAIR FINDING \(an earlier mission of this project, not this one\)\./u);
    expect(item.text).toContain(`run ${SOURCE}, about task ${SOURCE}:build`);
    expect(item.text).toContain(`resolved by review ${SOURCE}:review:repair-1`);
    expect(item.text).toContain('[HIGH, correctness, criterion AC-2] parseDate accepts 2026-02-30');
  });

  it('the copy stands VERIFIED on the resolving review, asserted by the reviewer, never by the carry', () => {
    const item = selectJuliusCarry({ targetRunId: TARGET, sources: [source([finding()], repairedLife('f-1'))], claims: [] }).selected[0]!;
    expect(item.claim).toEqual({
      claimId: juliusClaimIdFor(item.entryId), entryId: item.entryId, provenance: 'reviewer_verified', trust: 'VERIFIED',
      assertedBy: 'reviewer-hermes', assertedAt: '2026-10-01T10:00:00.000Z',
      evidence: [{ kind: 'REVIEW', id: `${SOURCE}:review:repair-1` }, { kind: 'FINDING', id: 'f-1' }],
      supersedes: null, contradicts: [],
    });
  });

  it('resolved with no repair round is a VERIFIED_FINDING, not a repair finding', () => {
    const ledger = [recorded('f-1', `${SOURCE}:review`), moved('f-1', 'REVIEWER_RESOLVED', { review: `${SOURCE}:review:2` })];
    const selection = selectJuliusCarry({ targetRunId: TARGET, sources: [source([finding()], ledger)], claims: [] });
    expect(selection.selected[0]!.carryClass).toBe('VERIFIED_FINDING');
    expect(selection.selected[0]!.text).toMatch(/^PRIOR VERIFIED FINDING /u);
    expect(selection.counts.VERIFIED_REPAIR_FINDING).toBe(0);
  });

  it('bounds a long reviewer claim and says it did', () => {
    const long = 'x'.repeat(JULIUS_CARRY_CLAIM_CHARS + 50);
    const item = selectJuliusCarry({ targetRunId: TARGET, sources: [source([finding({ claim: long })], repairedLife('f-1'))], claims: [] }).selected[0]!;
    expect(item.text.endsWith('…')).toBe(true);
    expect(item.text.split('\n')[2]!.length).toBeLessThan(JULIUS_CARRY_CLAIM_CHARS + 60);
  });
});

describe('what never carries: unverified, rejected and superseded findings', () => {
  const cases: [string, JuliusReviewerFinding, JuliusPeerLedgerEntry[], string, string | null][] = [
    ['an OPEN finding (an unverified observation)', finding(), [recorded('f-1', 'r')], 'FINDING_UNRESOLVED', 'OPEN'],
    ['a finding with no life at all', finding(), [], 'FINDING_UNRESOLVED', 'OPEN'],
    ['ADDRESSED: a repair acted, no reviewer said it worked', finding(),
      [recorded('f-1', 'r'), moved('f-1', 'REPAIR_SUCCEEDED', { repair: 'p' })], 'FINDING_ADDRESSED_NOT_VERIFIED', 'ADDRESSED'],
    ['MAINTAINED back to OPEN by the re-review', finding(),
      [recorded('f-1', 'r'), moved('f-1', 'REPAIR_SUCCEEDED', { repair: 'p' }), moved('f-1', 'REVIEWER_MAINTAINED', { review: 'q' })],
      'FINDING_UNRESOLVED', 'OPEN'],
    ['SUPERSEDED by a replacement', finding(),
      [recorded('f-1', 'r'), moved('f-1', 'REVIEWER_SUPERSEDED', { review: 'q', by: 'f-2' })], 'FINDING_SUPERSEDED', 'SUPERSEDED'],
    ['DISMISSED (a rejected finding), even if later resolved', finding({ status: 'DISMISSED' }), repairedLife('f-1'), 'FINDING_DISMISSED', 'RESOLVED'],
    ['RESOLVED, but no review is on record as raising it', finding(),
      [moved('f-1', 'REPAIR_SUCCEEDED', { repair: 'p' }), moved('f-1', 'REVIEWER_RESOLVED', { review: 'q' })], 'FINDING_ORIGIN_UNKNOWN', 'RESOLVED'],
    ['RESOLVED with no evidence', finding({ evidenceIds: [] }), repairedLife('f-1'), 'FINDING_WITHOUT_EVIDENCE', 'RESOLVED'],
  ];
  it.each(cases)('%s', (_name, row, ledger, code, detail) => {
    const selection = selectJuliusCarry({ targetRunId: TARGET, sources: [source([row], ledger)], claims: [] });
    expect(selection.selected).toEqual([]);
    expect(selection.excluded).toEqual([{ sourceRunId: SOURCE, sourceRef: 'finding:f-1', reasonCode: code, detail }]);
  });

  it('the run doing the carrying never carries from itself', () => {
    const selection = selectJuliusCarry({ targetRunId: SOURCE, sources: [source([finding()], repairedLife('f-1'))], claims: [] });
    expect(selection.selected).toEqual([]);
    expect(selection.excluded.map((item) => item.reasonCode)).toEqual(['SAME_RUN']);
  });
});

describe('what never carries: the defect class of the first carry', () => {
  it('a reviewed task\'s HANDOFF note, promoted VERIFIED by its accepted review, is task state and stays out', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate('brain:handoff:build', 'HANDOFF', `${SOURCE}:build`)],
    });
    expect(selection.selected).toEqual([]);
    expect(selection.excluded).toEqual([
      { sourceRunId: SOURCE, sourceRef: 'brain:handoff:build', reasonCode: 'KIND_NOT_CARRYABLE', detail: 'HANDOFF' },
    ]);
  });

  it('a PROPOSED architecture revision ("NOT IN FORCE"), promoted VERIFIED with its task, stays out by name', () => {
    const proposal = juliusArchitectureProposalEntryId(`${SOURCE}:plan:consult`);
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate(proposal, 'DECISION', `${SOURCE}:plan:consult`)],
    });
    expect(selection.excluded.map((item) => item.reasonCode)).toEqual(['DECISION_PROPOSED_NOT_IN_FORCE']);
  });

  it('a proposal stays out even if its task scope was lost on the way', () => {
    const proposal = juliusArchitectureProposalEntryId('t-9');
    const selection = selectJuliusCarry({ targetRunId: TARGET, sources: [], claims: [candidate(proposal, 'DECISION', null, { trust: 'APPROVED', evidence: [{ kind: 'DECISION', id: 'd' }] })] });
    expect(selection.excluded.map((item) => item.reasonCode)).toEqual(['DECISION_PROPOSED_NOT_IN_FORCE']);
  });

  it.each([
    ['CONSTRAINT', 'the mission objective is that mission\'s, not the project\'s'],
    ['REQUIREMENT', 'a requirement belongs to its mission'],
    ['ARTIFACT', 'an artifact is an observation, not a verified finding'],
    ['FINDING', 'a FINDING brain entry (a repair-round diff) is Julius\'s summary, not a reviewer\'s verified finding'],
    ['REPAIR', 'a repair note is task state'],
  ] as const)('%s at VERIFIED stays out: %s', (kind, _why) => {
    const selection = selectJuliusCarry({ targetRunId: TARGET, sources: [], claims: [candidate(`e:${kind}`, kind, null)] });
    expect(selection.selected).toEqual([]);
    expect(selection.excluded[0]!.reasonCode).toBe('KIND_NOT_CARRYABLE');
  });

  it('a task-scoped DECISION is never promoted to run-wide truth', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate('d:task', 'DECISION', 't-1', { trust: 'APPROVED', evidence: [{ kind: 'DECISION', id: 'd' }] })],
    });
    expect(selection.excluded).toEqual([{ sourceRunId: SOURCE, sourceRef: 'd:task', reasonCode: 'TASK_SCOPED', detail: 't-1' }]);
  });

  it('a decision whose scope the reader could not state is not read as run-wide', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate('d:unknown', 'DECISION', undefined, { trust: 'APPROVED', evidence: [{ kind: 'DECISION', id: 'd' }] })],
    });
    expect(selection.excluded.map((item) => item.reasonCode)).toEqual(['TASK_SCOPE_UNKNOWN']);
  });

  it('a run-wide DECISION merely VERIFIED by a review is not an adopted decision', () => {
    const selection = selectJuliusCarry({ targetRunId: TARGET, sources: [], claims: [candidate('d:verified', 'DECISION', null)] });
    expect(selection.excluded).toEqual([{ sourceRunId: SOURCE, sourceRef: 'd:verified', reasonCode: 'DECISION_NOT_ACCEPTED', detail: 'VERIFIED' }]);
  });

  it('APPROVED with no DECISION evidence names no authority and stays out', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [], claims: [candidate('d:noauth', 'DECISION', null, { trust: 'APPROVED' })],
    });
    expect(selection.excluded.map((item) => item.reasonCode)).toEqual(['DECISION_WITHOUT_AUTHORITY']);
  });

  it('a superseded or contradicted claim stays out, whatever it was', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [
        candidate('d:old', 'DECISION', null, { trust: 'SUPERSEDED' }),
        candidate('d:clash', 'DECISION', null, { trust: 'CONTRADICTED' }),
      ],
    });
    expect(selection.excluded.map((item) => [item.reasonCode, item.detail])).toEqual([
      ['CLAIM_TERMINAL', 'SUPERSEDED'], ['CLAIM_TERMINAL', 'CONTRADICTED'],
    ]);
  });

  it('a copy is never carried again: one source, one origin', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate(juliusCarryEntryId('run:older', 'finding:f-0'), 'FINDING', null)],
    });
    expect(selection.excluded.map((item) => item.reasonCode)).toEqual(['CARRY_OF_CARRY']);
  });
});

describe('what carries: adopted, in-force, run-wide decisions', () => {
  it('a run-wide DECISION standing APPROVED on DECISION evidence carries, labelled as another mission\'s', () => {
    const entryId = juliusArchitectureEntryId(SOURCE, 2);
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate(entryId, 'DECISION', null, { trust: 'APPROVED', evidence: [{ kind: 'DECISION', id: 'decision-7' }], assertedBy: 'founder' })],
    });
    const item = selection.selected[0]!;
    expect(item.carryClass).toBe('ACCEPTED_DECISION');
    expect(item.storedKind).toBe('DECISION');
    expect(item.text).toMatch(/^PRIOR ACCEPTED ARCHITECTURE DECISION \(an earlier mission of this project, adopted there; not this mission's terms\)\./u);
    expect(item.claim.trust).toBe('APPROVED');
    expect(item.claim.assertedBy).toBe('founder');
    expect(item.claim.entryId).toBe(juliusCarryEntryId(SOURCE, entryId));
    expect(item.scope.sourceTaskId).toBeNull();
  });
});

describe('ordering, cap and replay', () => {
  it('repair findings first, then plain findings, then decisions; newest first within a class; cap enforced and recorded', () => {
    const findings: JuliusReviewerFinding[] = [];
    const ledger: JuliusPeerLedgerEntry[] = [];
    for (let index = 0; index < JULIUS_CARRY_LIMIT + 2; index += 1) {
      const id = `f-${String(index).padStart(2, '0')}`;
      findings.push(finding({ findingId: id, createdAt: `2026-10-01T10:${String(index).padStart(2, '0')}:00.000Z` }));
      ledger.push(...repairedLife(id));
    }
    const plain = finding({ findingId: 'plain', createdAt: '2026-10-02T00:00:00.000Z' });
    ledger.push(recorded('plain', 'r'), moved('plain', 'REVIEWER_RESOLVED', { review: 'q' }));
    const selection = selectJuliusCarry({
      targetRunId: TARGET,
      sources: [source([...findings, plain], ledger)],
      claims: [candidate('d:1', 'DECISION', null, { trust: 'APPROVED', evidence: [{ kind: 'DECISION', id: 'd' }] })],
    });
    expect(selection.selected).toHaveLength(JULIUS_CARRY_LIMIT);
    expect(selection.selected.every((item) => item.carryClass === 'VERIFIED_REPAIR_FINDING')).toBe(true);
    expect(selection.selected[0]!.scope.sourceRef).toBe(`finding:f-${String(JULIUS_CARRY_LIMIT + 1)}`);
    expect(selection.excluded.filter((item) => item.reasonCode === 'CARRY_LIMIT').map((item) => item.detail)).toEqual([
      'VERIFIED_REPAIR_FINDING', 'VERIFIED_REPAIR_FINDING', 'VERIFIED_FINDING', 'ACCEPTED_DECISION',
    ]);
  });

  it('the same inputs select the same carry, and the same fact reached twice is one item', () => {
    const run = source([finding()], repairedLife('f-1'));
    const once = selectJuliusCarry({ targetRunId: TARGET, sources: [run], claims: [] });
    const twice = selectJuliusCarry({ targetRunId: TARGET, sources: [run, run], claims: [] });
    expect(twice.selected).toEqual(once.selected);
  });
});

describe('the pair gate', () => {
  const valid = selectJuliusCarry({ targetRunId: TARGET, sources: [source([finding()], repairedLife('f-1'))], claims: [] });
  const empty = selectJuliusCarry({ targetRunId: TARGET, sources: [], claims: [] });
  const designOnly = selectJuliusCarry({
    targetRunId: TARGET, sources: [],
    claims: [candidate('d:1', 'DECISION', null, { trust: 'APPROVED', evidence: [{ kind: 'DECISION', id: 'd' }] })],
  });
  const findingOnly = selectJuliusCarry({
    targetRunId: TARGET,
    sources: [source([finding()], [recorded('f-1', 'r'), moved('f-1', 'REVIEWER_RESOLVED', { review: 'q' })])],
    claims: [],
  });

  it('a WITH arm holding a verified repair finding is valid', () => {
    expect(juliusCarryPairGate('WITH', valid)).toEqual({ valid: true, reasonCode: 'CARRY_PAIR_VALID' });
  });
  it('an empty carry invalidates the pair', () => {
    expect(juliusCarryPairGate('WITH', empty)).toEqual({ valid: false, reasonCode: 'CARRY_EMPTY' });
  });
  it('design-only carry does not satisfy the pair', () => {
    expect(juliusCarryPairGate('WITH', designOnly)).toEqual({ valid: false, reasonCode: 'CARRY_DESIGN_ONLY' });
  });
  it('a verified finding with no repair does not satisfy it either', () => {
    expect(juliusCarryPairGate('WITH', findingOnly)).toEqual({ valid: false, reasonCode: 'CARRY_DESIGN_ONLY' });
  });
  it('an unreadable carry is UNKNOWN, which is neither empty nor valid', () => {
    expect(juliusCarryPairGate('WITH', null)).toEqual({ valid: false, reasonCode: 'CARRY_UNKNOWN' });
  });
  it('a WITHOUT arm, or a mission outside any pair, has nothing to judge', () => {
    expect(juliusCarryPairGate('WITHOUT', empty).valid).toBe(true);
    expect(juliusCarryPairGate(null, null).valid).toBe(true);
  });
});

describe('point 4: what the planner received', () => {
  it('reads the carried ids off the packet, and names what was carried but not given', () => {
    const a = juliusCarryEntryId(SOURCE, 'finding:f-1');
    const b = juliusCarryEntryId(SOURCE, 'finding:f-2');
    const packet = ['run:with-1:objective', a, 'brain:architecture:run:with-1:r1'];
    expect(juliusCarriedIdsIn(packet)).toEqual([a]);
    expect(juliusCarryReceipt({ carriedEntryIds: [b, a], packetSourceEntryIds: packet })).toEqual({ received: [a], missing: [b] });
    expect(isJuliusCarriedEntryId('run:with-1:objective')).toBe(false);
  });
});

describe('the manifest as event facts', () => {
  it('counts exactly, lists ids, and stays scalar', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET,
      sources: [source([finding(), finding({ findingId: 'f-open' })], [...repairedLife('f-1'), recorded('f-open', 'r')])],
      claims: [candidate('brain:handoff:build', 'HANDOFF', `${SOURCE}:build`)],
    });
    const facts = juliusCarryManifestFacts({ arm: 'WITH', selection, written: 1 });
    expect(facts).toMatchObject({
      version: JULIUS_CARRY_VERSION, arm: 'WITH', selected: 1, verifiedRepairFindings: 1, verifiedFindings: 0,
      acceptedDecisions: 0, excluded: 2, excludedByCode: 'FINDING_UNRESOLVED=1 KIND_NOT_CARRYABLE=1', written: 1,
      selectedEntryIds: juliusCarryEntryId(SOURCE, 'finding:f-1'), selectedEntryIdsTruncated: false,
    });
    expect(String(facts.excludedRefs)).toContain(`KIND_NOT_CARRYABLE:${SOURCE}:brain:handoff:build`);
    for (const value of Object.values(facts)) expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
    expect(JSON.stringify(facts).length).toBeLessThan(8_192);
    // The reviewer's words are not on the event: ids and counts only.
    expect(JSON.stringify(facts)).not.toContain('parseDate');
  });

  it('a list that would trip the ledger\'s credential check is recorded by count only', () => {
    const selection = selectJuliusCarry({
      targetRunId: TARGET, sources: [],
      claims: [candidate('token: x', 'HANDOFF', 't')],
    });
    const facts = juliusCarryManifestFacts({ arm: null, selection, written: 0 });
    expect(facts.excludedRefs).toBeNull();
    expect(facts.excluded).toBe(1);
  });

  it('the exclusion vocabulary is closed: adding a code is a deliberate change to this test', () => {
    // FINDING_RESOLUTION_UNKNOWN is a guard the fold cannot reach today (RESOLVED
    // is only ever reached by REVIEWER_RESOLVED naming a review); it stays so a
    // future fold change cannot quietly carry a resolution nobody declared.
    expect(JULIUS_CARRY_EXCLUSION_CODES).toHaveLength(17);
  });
});
