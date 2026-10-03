import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifyContextAuthority, compileContextWithIntegrity, detectContextConflicts, type JuliusContextCandidate, type JuliusContextType } from './julius-context-integrity';
import {
  JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW,
  JULIUS_ACCEPTING_VERDICTS,
  JULIUS_LINEAGE_FAMILIES,
  JULIUS_LINEAGE_VERIFIED_TRUSTS,
  JULIUS_VERDICT_FINDING_TABLE,
  assertJuliusLineage,
  juliusContradictionConflict,
  juliusContradictionFacts,
  juliusGovernanceEntries,
  juliusRunContradictions,
  juliusRunContradictionsFromRecords,
  juliusVerdictFindingRow,
} from './julius-lineage-asserter';
import type { JuliusMemoryClaim, JuliusMemoryProvenance, JuliusMemoryTrustState } from './julius-memory-trust';
import type { JuliusBrainEntry, JuliusContextQualification, JuliusDecisionAction } from './julius-runtime';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE LINEAGE ASSERTER (founder decision B, 2026-10-03), held to the founder's rules and to the probes Second Julius
 * pre-registered before any of it was written (PREREG_SECOND_AB_PROBES.md B-1..B-7). Each case is built so that an
 * asserter skipping the rule it names would fail it.
 */

const AT = '2026-10-03T12:00:00.000Z';
const entry = (entryId: string, text: string, over: Partial<JuliusBrainEntry> = {}): JuliusBrainEntry => ({
  entryId, kind: over.kind ?? 'DECISION', text, taskIds: over.taskIds ?? [], allowedRoles: over.allowedRoles ?? ['CODING_AGENT'],
  sensitivity: over.sensitivity ?? 'INTERNAL', provenance: over.provenance,
});
const claim = (entryId: string, trust: JuliusMemoryTrustState, provenance: JuliusMemoryProvenance = 'run_observed'): JuliusMemoryClaim => ({
  claimId: `claim:${entryId}`, entryId, provenance, trust, assertedBy: 'independent-reviewer', assertedAt: AT, evidence: [], supersedes: null, contradicts: [],
});
const qualify = (pairs: readonly [JuliusBrainEntry, JuliusMemoryClaim, JuliusContextType?][]): JuliusContextQualification => ({
  claims: pairs.map(([, held]) => held),
  contextTypes: Object.fromEntries(pairs.map(([held, , type]) => [held.entryId, type ?? 'INSTRUCTION'])),
  recordedAt: Object.fromEntries(pairs.map(([held]) => [held.entryId, AT])),
  contractEntryIds: [],
});
const claimOf = (qualification: JuliusContextQualification, entryId: string) => qualification.claims.find((held) => held.entryId === entryId)!;
const verdict = (taskId: string, action: JuliusDecisionAction, reason = 'TASK_VERIFIED') => entry(`brain:decision:${taskId}:${action}:${reason}`, `${action} (${reason})`, { taskIds: [taskId] });

describe('the compatibility table (founder decision B, rule 2\'s live path)', () => {
  const ACTIONS: JuliusDecisionAction[] = ['ACCEPT', 'REPAIR', 'REROUTE', 'RETRY', 'ESCALATE', 'HALT', 'COMPLETE'];
  const STATUSES: JuliusReviewerFinding['status'][] = ['OPEN', 'RESOLVED', 'DISMISSED'];
  const TRUSTS: JuliusMemoryTrustState[] = ['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED', 'CONTRADICTED', 'SUPERSEDED'];

  it('is CLOSED and TOTAL: every verdict x status x blocking x trust falls in exactly one row, and exactly four are incompatible', () => {
    const incompatible: string[] = [];
    for (const action of ACTIONS) for (const status of STATUSES) for (const blocking of [true, false]) for (const trust of TRUSTS) {
      const matching = JULIUS_VERDICT_FINDING_TABLE.filter((row) => row.verdicts.includes(action) && row.statuses.includes(status)
        && row.blocking.includes(blocking) && row.trusts.includes(trust));
      expect(matching.map((row) => row.rowId), `${action} ${status} ${String(blocking)} ${trust}`).toHaveLength(1);
      if (juliusVerdictFindingRow({ verdict: action, status, blocking, trust }).result === 'INCOMPATIBLE') incompatible.push(`${action} ${status} ${String(blocking)} ${trust}`);
    }
    expect(incompatible, 'ACCEPT and COMPLETE (the pipeline accepts on both) x OPEN x blocking x VERIFIED-or-APPROVED, and nothing else').toEqual([
      'ACCEPT OPEN true VERIFIED', 'ACCEPT OPEN true APPROVED', 'COMPLETE OPEN true VERIFIED', 'COMPLETE OPEN true APPROVED',
    ]);
    expect(JULIUS_VERDICT_FINDING_TABLE.map((row) => `${row.rowId}=${row.result}`)).toEqual([
      `${JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW}=INCOMPATIBLE`, 'ACCEPT_X_OPEN_BLOCKING_NOT_VERIFIED=COMPATIBLE', 'ACCEPT_X_OPEN_NON_BLOCKING=COMPATIBLE',
      'ACCEPT_X_RESOLVED=COMPATIBLE', 'NOT_AN_ACCEPTANCE=COMPATIBLE',
    ]);
    expect([...JULIUS_LINEAGE_VERIFIED_TRUSTS], 'founder I1').toEqual(['VERIFIED', 'APPROVED']);
    expect([...JULIUS_ACCEPTING_VERDICTS]).toEqual(['ACCEPT', 'COMPLETE']);
  });

  it('is in the harness map, as the trust core it belongs to (a new kernel file with no FILE_RULES entry fails the export)', () => {
    const exporter = readFileSync(join(process.cwd(), 'scripts', 'export-julius-harness.mjs'), 'utf8');
    expect(exporter).toContain("['src/relay/mission/julius/julius-lineage-asserter.ts', 'DURABLE STATE / PROJECT BRAIN'],");
    expect(readFileSync(join(process.cwd(), 'JULIUS_HARNESS_MANIFEST.md'), 'utf8')).toContain('src/relay/mission/julius/julius-lineage-asserter.ts');
  });

  it('pins the closed families (an entry in none gets no lineage)', () => {
    expect(JULIUS_LINEAGE_FAMILIES.map((family) => `${family.family} ${family.shape.source}`)).toEqual([
      'V ^brain:decision:(.+):(ACCEPT|REPAIR|REROUTE|RETRY|ESCALATE|HALT|COMPLETE):([A-Z0-9_]+)$',
      'R ^((?:brain:architecture|brain:guidance-answer):.+):r([1-9][0-9]*)$',
      'R ^(pbr:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@v([1-9][0-9]*)$',
    ]);
  });
});

describe('rule 1, SUPERSEDES: a later verified revision of the same subject', () => {
  it('B-1: a later revision that is not verified supersedes nothing; a later verified one supersedes and the earlier leaves', () => {
    const r1 = entry('brain:architecture:run:a:r1', 'one');
    const r2 = entry('brain:architecture:run:a:r2', 'two');
    const unverified = assertJuliusLineage({ qualification: qualify([[r1, claim(r1.entryId, 'VERIFIED')], [r2, claim(r2.entryId, 'SUPPORTED')]]), entries: [r1, r2], revisions: {} });
    expect(claimOf(unverified.qualification, r1.entryId)).toMatchObject({ trust: 'VERIFIED', supersedes: null });
    expect(claimOf(unverified.qualification, r2.entryId)).toMatchObject({ trust: 'SUPPORTED', supersedes: null });

    const verified = assertJuliusLineage({ qualification: qualify([[r1, claim(r1.entryId, 'VERIFIED')], [r2, claim(r2.entryId, 'APPROVED')]]), entries: [r1, r2], revisions: {} });
    expect(claimOf(verified.qualification, r1.entryId).trust).toBe('SUPERSEDED');
    expect(claimOf(verified.qualification, r2.entryId)).toMatchObject({ trust: 'APPROVED', supersedes: `claim:${r1.entryId}` });
  });

  it('B-2: a task\'s verdicts are ordered by their DURABLE revision, never by time or by the order they arrive in', () => {
    const repair = verdict('run:a:build', 'REPAIR', 'BLOCKING_FINDING');
    const accept = verdict('run:a:build', 'ACCEPT');
    // The ACCEPT was recorded EARLIER in time but later in the brain: revision decides.
    const held = (forRepair: string, forAccept: string): JuliusContextQualification => ({
      ...qualify([[repair, claim(repair.entryId, 'APPROVED')], [accept, claim(accept.entryId, 'APPROVED')]]),
      recordedAt: { [repair.entryId]: forRepair, [accept.entryId]: forAccept },
    });
    const revisions = { [repair.entryId]: 5, [accept.entryId]: 9 };
    const outcomes = [
      assertJuliusLineage({ qualification: held('2026-10-03T12:00:00Z', '2026-10-03T11:00:00Z'), entries: [repair, accept], revisions }),
      assertJuliusLineage({ qualification: held('2026-10-03T11:00:00Z', '2026-10-03T12:00:00Z'), entries: [accept, repair], revisions }),
    ];
    for (const outcome of outcomes) {
      expect(claimOf(outcome.qualification, repair.entryId).trust).toBe('SUPERSEDED');
      expect(claimOf(outcome.qualification, accept.entryId).supersedes).toBe(`claim:${repair.entryId}`);
    }
    const unordered = assertJuliusLineage({ qualification: held(AT, AT), entries: [repair, accept], revisions: {} });
    expect(unordered.qualification.claims.every((held) => held.supersedes === null && held.trust === 'APPROVED'), 'no durable revision, no lineage').toBe(true);
  });
});

describe('rule 2, CONTRADICTS: incompatible verified values of one subject fail closed, and nothing chooses between them', () => {
  const tied = (left: JuliusDecisionAction, right: JuliusDecisionAction) => {
    const a = verdict('run:a:build', left, 'FIRST');
    const b = verdict('run:a:build', right, 'SECOND');
    return { a, b, asserted: assertJuliusLineage({ qualification: qualify([[a, claim(a.entryId, 'APPROVED')], [b, claim(b.entryId, 'APPROVED')]]), entries: [a, b], revisions: { [a.entryId]: 7, [b.entryId]: 7 } }) };
  };

  it('B-3: equal values at one place in the order agree: no contradiction is asserted', () => {
    const { asserted } = tied('ACCEPT', 'ACCEPT');
    expect(asserted.qualification.claims.every((held) => held.contradicts.length === 0)).toBe(true);
    expect(asserted.qualification.incompatible).toEqual([]);
  });

  it('B-4: unequal values contradict each other, and the compiler FAILS CLOSED on them by the table, not by authority, trust or contract', () => {
    const { a, b, asserted } = tied('ACCEPT', 'REPAIR');
    expect(claimOf(asserted.qualification, a.entryId).contradicts).toEqual([`claim:${b.entryId}`]);
    expect(claimOf(asserted.qualification, b.entryId).contradicts).toEqual([`claim:${a.entryId}`]);
    expect(asserted.qualification.incompatible).toEqual([[`claim:${a.entryId}`, `claim:${b.entryId}`].sort()]);
    const candidates: JuliusContextCandidate[] = [a, b].map((held) => ({ entry: { ...held, taskIds: [] }, claim: claimOf(asserted.qualification, held.entryId), contextType: 'INSTRUCTION' as const, recordedAt: AT }));
    const outcome = compileContextWithIntegrity({ candidates, role: 'CODING_AGENT', taskId: 'run:a:next', contractEntryIds: [], budgetCharacters: 10_000, incompatible: asserted.qualification.incompatible });
    expect(outcome).toMatchObject({ outcome: 'FAIL_CLOSED', conflicts: [{ resolution: 'UNRESOLVED', reasonCode: 'INCOMPATIBLE_BY_COMPATIBILITY_TABLE' }] });
  });

  it('STEP 0: a table pair is UNRESOLVED even when authority alone would have kept one side; the same pair outside the table resolves as before', () => {
    const accept = { entry: entry('brain:decision:t:ACCEPT:TASK_VERIFIED', 'ACCEPT'), claim: { ...claim('brain:decision:t:ACCEPT:TASK_VERIFIED', 'APPROVED'), contradicts: ['claim:finding:f1'] }, contextType: 'INSTRUCTION' as const, recordedAt: AT };
    const finding = { entry: entry('finding:f1', 'blocking finding', { kind: 'FINDING' }), claim: claim('finding:f1', 'VERIFIED', 'reviewer_verified'), contextType: 'REVIEW_FINDING' as const, recordedAt: AT };
    expect(classifyContextAuthority(accept)).not.toBe(classifyContextAuthority(finding));
    expect(detectContextConflicts([accept, finding], { contractEntryIds: [] })[0]!.resolution, 'CONTROL: without the table, authority keeps ACCEPT').toBe('RESOLVED_BY_AUTHORITY');
    expect(detectContextConflicts([accept, finding], { contractEntryIds: [], incompatible: [['claim:finding:f1', accept.claim.claimId]] })[0])
      .toMatchObject({ resolution: 'UNRESOLVED', keptClaimId: null, reasonCode: 'INCOMPATIBLE_BY_COMPATIBILITY_TABLE' });
  });
});

describe('rule 2, run-wide: an accepted task with an open blocking verified finding is a contradiction the run holds', () => {
  const task = 'run:a:build';
  const recordedVerdict = (action: JuliusDecisionAction, revision: number, reason = 'TASK_VERIFIED') => {
    const held = verdict(task, action, reason);
    return { entry: held, claim: claim(held.entryId, 'APPROVED'), revision };
  };
  const recordedFinding = (status: JuliusReviewerFinding['status'], blocking: boolean, trust: JuliusMemoryTrustState, id = 'f1') => ({
    finding: { findingId: id, runId: 'run:a', taskId: task, reviewerWorkerId: 'independent-reviewer', severity: 'HIGH' as const, category: 'correctness', claim: 'x',
      criterionId: null, evidenceIds: ['e1'], blocking, status, createdAt: AT },
    entryId: `finding:${id}`,
    claim: claim(`finding:${id}`, trust, 'reviewer_verified'),
  });

  it('ACCEPT + OPEN-BLOCKING-VERIFIED = CONTRADICTS (family A, the founder\'s row), recorded with both sides; ACCEPT + RESOLVED = compatible', () => {
    const found = juliusRunContradictions({ verdicts: [recordedVerdict('ACCEPT', 9)], findings: [recordedFinding('OPEN', true, 'VERIFIED')] });
    expect(found).toEqual([{
      family: 'A', subject: `acceptance:${task}`, rowId: JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW,
      left: { entryId: `brain:decision:${task}:ACCEPT:TASK_VERIFIED`, claimId: `claim:brain:decision:${task}:ACCEPT:TASK_VERIFIED`, value: 'ACCEPT', trust: 'APPROVED' },
      right: { entryId: 'finding:f1', claimId: 'claim:finding:f1', value: 'OPEN_BLOCKING_VERIFIED', trust: 'VERIFIED' },
    }]);
    expect(juliusContradictionConflict(found[0]!)).toMatchObject({ resolution: 'UNRESOLVED', keptClaimId: null, reasonCode: `INCOMPATIBLE_BY_COMPATIBILITY_TABLE:${JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW}` });
    expect(juliusRunContradictions({ verdicts: [recordedVerdict('ACCEPT', 9)], findings: [recordedFinding('RESOLVED', true, 'VERIFIED')] })).toEqual([]);
  });

  it('judges the LATEST verdict by revision: REPAIR then ACCEPT is an acceptance; ACCEPT then REPAIR is not', () => {
    const open = [recordedFinding('OPEN', true, 'APPROVED')];
    expect(juliusRunContradictions({ verdicts: [recordedVerdict('ACCEPT', 9), recordedVerdict('REPAIR', 5, 'BLOCKING')], findings: open })).toHaveLength(1);
    expect(juliusRunContradictions({ verdicts: [recordedVerdict('ACCEPT', 5), recordedVerdict('REPAIR', 9, 'BLOCKING')], findings: open })).toEqual([]);
    expect(juliusRunContradictions({ verdicts: [recordedVerdict('COMPLETE', 9)], findings: open }), 'COMPLETE accepts too').toHaveLength(1);
  });

  it('below the verified rungs, or non-blocking, a finding does not contradict an acceptance; two verdicts at one revision with different actions do', () => {
    expect(juliusRunContradictions({ verdicts: [recordedVerdict('ACCEPT', 9)], findings: [recordedFinding('OPEN', true, 'SUPPORTED'), recordedFinding('OPEN', false, 'VERIFIED', 'f2')] })).toEqual([]);
    const tie = juliusRunContradictions({ verdicts: [recordedVerdict('ACCEPT', 9), recordedVerdict('REPAIR', 9, 'BLOCKING')], findings: [] });
    expect(tie.map((held) => `${held.family} ${held.rowId}`)).toEqual(['V VERDICTS_AT_ONE_REVISION']);
  });
});

describe('rule 2, from the run\'s durable records (what the dispatch path and completion check)', () => {
  const task = 'run:a:build';
  const accept: JuliusBrainEntry = {
    entryId: `brain:decision:${task}:ACCEPT:TASK_VERIFIED`, kind: 'DECISION', text: 'ACCEPT (TASK_VERIFIED): verified', taskIds: [task],
    allowedRoles: ['INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL', provenance: { workerId: 'independent-reviewer', recordedAt: AT, evidenceIds: ['e1'] }, revision: 9,
  };
  const finding = (id: string, evidenceIds: string[], over: Partial<JuliusReviewerFinding> = {}): JuliusReviewerFinding => ({
    findingId: id, runId: 'run:a', taskId: task, reviewerWorkerId: 'independent-reviewer', severity: 'HIGH', category: 'correctness', claim: 'x',
    criterionId: null, evidenceIds, blocking: true, status: 'OPEN', createdAt: AT, ...over,
  });

  it('a blocking OPEN finding that cites evidence stands VERIFIED from its own record, and contradicts the acceptance', () => {
    const found = juliusRunContradictionsFromRecords({ brain: [accept], findings: [finding('f1', ['e1'])], claims: [] });
    expect(found.map((held) => `${held.family} ${held.rowId} ${held.right.trust}`)).toEqual([`A ${JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW} VERIFIED`]);
  });

  it('one that cites nothing is not verified (the context layer\'s own rule), and a recorded standing wins over the derivation', () => {
    expect(juliusRunContradictionsFromRecords({ brain: [accept], findings: [finding('f2', [])], claims: [] })).toEqual([]);
    const recorded = { ...claim(`finding:${task}:f1`, 'SUPERSEDED', 'reviewer_verified') };
    expect(juliusRunContradictionsFromRecords({ brain: [accept], findings: [finding('f1', ['e1'])], claims: [recorded] }), 'the record wins').toEqual([]);
  });

  it('a verdict with no durable revision cannot be ordered, so it is not judged; a RESOLVED finding never is', () => {
    expect(juliusRunContradictionsFromRecords({ brain: [{ ...accept, revision: undefined }], findings: [finding('f1', ['e1'])], claims: [] })).toEqual([]);
    expect(juliusRunContradictionsFromRecords({ brain: [accept], findings: [finding('f1', ['e1'], { status: 'RESOLVED' })], claims: [] })).toEqual([]);
  });

  it('as event facts the pair is flat, closed values and ids only, and bounded', () => {
    const found = juliusRunContradictionsFromRecords({ brain: [accept], findings: [finding('f1', ['e1']), finding('f3', ['e2'])], claims: [] });
    const facts = juliusContradictionFacts(found);
    expect(Object.values(facts).every((value) => typeof value === 'string' || typeof value === 'number')).toBe(true);
    expect(facts).toMatchObject({
      contradictions: 2, contradictionFamily: 'A', contradictionSubject: `acceptance:${task}`, contradictionRow: JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW,
      contradictionLeft: `${accept.entryId}|claim:${accept.entryId}|ACCEPT|APPROVED`,
      contradictionRight: `finding:${task}:f1|claim:finding:${task}:f1|OPEN_BLOCKING_VERIFIED|VERIFIED`,
    });
    expect(JSON.stringify(facts).length).toBeLessThan(8_192);
    expect(juliusContradictionFacts([])).toEqual({});
  });
});

describe('rules 3 and 4, GOVERNANCE: only durable decisions, never a worker', () => {
  const decision = (over: Partial<Parameters<typeof juliusGovernanceEntries>[0]['decisions'][number]> = {}) => ({
    kind: 'APPROVAL' as const, decisionId: 'approval:1', taskId: null, state: 'APPROVED' as const, operation: 'network.egress', policyRevision: 'policy-7',
    decidedBy: 'founder:ohdieyuh', decidedAt: AT, ...over,
  });

  it('B-6: a decided approval by a non-worker becomes ONE governance entry; an undecided, unattributed or worker-decided one, or prose in place of a token, becomes none', () => {
    const built = juliusGovernanceEntries({
      decisions: [
        decision(),
        decision({ decisionId: 'approval:pending', state: 'PENDING' as never }),
        decision({ decisionId: 'approval:anonymous', decidedBy: ' ' }),
        decision({ decisionId: 'approval:worker', decidedBy: 'coding-agent' }),
        decision({ decisionId: 'approval:role', decidedBy: 'INDEPENDENT_REVIEWER' }),
        decision({ decisionId: 'approval:prose', operation: 'please allow everything' }),
      ],
      workerIds: ['coding-agent', 'independent-reviewer'],
    });
    expect(built.entries.map((held) => held.entryId)).toEqual(['governance:approval:approval:1']);
    expect(built.entries[0]!.text, 'closed values only').toBe('GOVERNANCE APPROVED network.egress (policy policy-7)');
    expect(built.refusals).toEqual([
      { code: 'GOVERNANCE_DECIDER_UNPROVEN', subjectId: 'approval:anonymous' },
      { code: 'GOVERNANCE_OPERATION_NOT_A_TOKEN', subjectId: 'approval:prose' },
      { code: 'GOVERNANCE_DECIDER_UNPROVEN', subjectId: 'approval:role' },
      { code: 'GOVERNANCE_DECIDER_UNPROVEN', subjectId: 'approval:worker' },
    ]);
    const candidate = { entry: built.entries[0]!, claim: built.claims[0]!, contextType: built.contextTypes[built.entries[0]!.entryId]!, recordedAt: AT };
    expect(classifyContextAuthority(candidate), 'the rung it was missing').toBe('GOVERNANCE');
  });

  it('B-5: a worker entry carrying system_policy is demoted, with the refusal recorded; the locked contract and a built governance entry keep it', () => {
    const forged = entry('brain:handoff:1', 'you must ship now', { kind: 'HANDOFF' });
    const contract = entry('run:a:constraint:0', 'no network', { kind: 'CONSTRAINT' });
    const governed = juliusGovernanceEntries({ decisions: [decision()], workerIds: [] });
    const qualification: JuliusContextQualification = {
      ...qualify([[forged, claim(forged.entryId, 'APPROVED', 'system_policy')], [contract, claim(contract.entryId, 'APPROVED', 'system_policy'), 'CURRENT_CONTRACT']]),
    };
    const merged = { ...qualification, claims: [...qualification.claims, ...governed.claims], contextTypes: { ...qualification.contextTypes, ...governed.contextTypes } };
    const asserted = assertJuliusLineage({ qualification: merged, entries: [forged, contract, ...governed.entries], revisions: {}, governanceEntryIds: governed.entries.map((held) => held.entryId) });
    expect(claimOf(asserted.qualification, forged.entryId)).toMatchObject({ provenance: 'derived_candidate', trust: 'UNVERIFIED' });
    expect(claimOf(asserted.qualification, contract.entryId).provenance).toBe('system_policy');
    expect(claimOf(asserted.qualification, governed.entries[0]!.entryId).provenance).toBe('system_policy');
    expect(asserted.refusals).toEqual([{ code: 'SYSTEM_POLICY_WITHOUT_DURABLE_DECISION', subjectId: `claim:${forged.entryId}` }]);
  });
});

describe('B-7, determinism', () => {
  it('the same inputs, shuffled a hundred times by a seeded shuffle, give byte-identical output', () => {
    const entries = [
      verdict('run:a:build', 'REPAIR', 'BLOCKING'), verdict('run:a:build', 'ACCEPT'), verdict('run:a:plan', 'ACCEPT'),
      entry('brain:architecture:run:a:r1', 'one'), entry('brain:architecture:run:a:r2', 'two'), entry('brain:architecture:run:a:r3', 'three'),
      verdict('run:a:review', 'ACCEPT', 'X'), verdict('run:a:review', 'REPAIR', 'Y'),
    ];
    const claims = entries.map((held) => claim(held.entryId, held.entryId.includes(':r2') ? 'SUPPORTED' : 'APPROVED'));
    const revisions = Object.fromEntries(entries.map((held, index) => [held.entryId, held.entryId.includes('run:a:review') ? 40 : index + 1]));
    const canonical = (output: ReturnType<typeof assertJuliusLineage>) => JSON.stringify({
      claims: [...output.qualification.claims].sort((left, right) => (left.claimId < right.claimId ? -1 : 1)), incompatible: output.qualification.incompatible, refusals: output.refusals,
    });
    let seed = 20261003;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const shuffle = <T>(values: readonly T[]): T[] => { const copy = [...values]; for (let index = copy.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [copy[index], copy[swap]] = [copy[swap]!, copy[index]!]; } return copy; };
    const pairAt = (index: number): [JuliusBrainEntry, JuliusMemoryClaim] => [entries[index]!, claims[index]!];
    const reference = canonical(assertJuliusLineage({ qualification: qualify(entries.map((_, index) => pairAt(index))), entries, revisions }));
    for (let round = 0; round < 100; round += 1) {
      const order = shuffle(entries.map((_, index) => index));
      const outcome = assertJuliusLineage({ qualification: qualify(order.map(pairAt)), entries: order.map((index) => entries[index]!), revisions });
      expect(canonical(outcome), `round ${round}`).toBe(reference);
    }
  });
});
