import { describe, expect, it } from 'vitest';

import { juliusArchitectureEntryId, juliusArchitectureProposalEntryId } from './julius-architecture-state';
import {
  JULIUS_CARRIED_CLAIM_CHARS, JULIUS_CARRY_EXCLUSIONS, JULIUS_CLAIM_LEDGER_VERSION, JULIUS_KNOWLEDGE_CARRY_VERSION,
  isJuliusCarriedEntryId, juliusAdmittedClaimFor, juliusCarriedCopyId, juliusCarryFindingCandidate, juliusClaimIdFor, juliusClaimPromotionsOnAccept,
  juliusClaimStandingKey, juliusKnowledgeCarriedEvent, juliusKnowledgeCarryFacts, juliusKnowledgeCarryFailureFacts,
  juliusKnowledgeConsumedFacts, mergeJuliusDurableStanding, planJuliusKnowledgeCarry,
  type JuliusCarryArchitectureFact, type JuliusCarryBrainCandidate, type JuliusCarryFindingCandidate, type JuliusCarryScope,
  type JuliusCarrySourceRun,
} from './julius-claim-ledger';
import { deriveJuliusContextQualification } from './julius-context-provenance';
import { validateJuliusEvent } from './julius-events';
import type { JuliusMemoryClaim } from './julius-memory-trust';
import type { JuliusBrainEntry } from './julius-runtime';
import type { JuliusBrainAppend } from './julius-runtime-ports';

/**
 * THE CLAIM LEDGER, HELD TO ITS THREE PROMISES: a durable claim is the derived
 * claim at birth; an accepted review promotes exactly the reviewed task's
 * entries, through the trust core's refusals; and a recorded standing replaces
 * the derived one at compile, for that claim only.
 */

const append = (over: Partial<JuliusBrainAppend> = {}): JuliusBrainAppend => ({
  runId: 'run-1', projectId: 'prj-1', taskId: 'build-1', workerId: 'coder',
  entryId: 'entry:evidence-1', kind: 'EVIDENCE', safeText: 'node --test: 4 passed.',
  evidenceIds: ['evidence:test-1'], occurredAt: '2026-09-27T10:00:00.000Z', ...over,
});

const entryOf = (input: JuliusBrainAppend): JuliusBrainEntry => ({
  entryId: input.entryId, kind: input.kind, text: input.safeText,
  taskIds: input.taskId === null ? [] : [input.taskId],
  allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  provenance: { workerId: input.workerId, recordedAt: input.occurredAt, evidenceIds: input.evidenceIds },
});

describe('admission', () => {
  it('records the derived claim, not a second opinion: same id, same standing, same evidence', () => {
    const input = append();
    const admitted = juliusAdmittedClaimFor(input);
    const derived = deriveJuliusContextQualification([entryOf(input)]).claims[0]!;
    expect(admitted).toEqual(derived);
    expect(admitted.claimId).toBe(juliusClaimIdFor('entry:evidence-1'));
    expect(admitted.trust, 'an EVIDENCE entry that cites something is SUPPORTED at birth').toBe('SUPPORTED');
    expect(admitted.assertedBy).toBe('coder');
  });

  it('withholds standing exactly as the derivation does: a citing kind that cites nothing is UNVERIFIED', () => {
    expect(juliusAdmittedClaimFor(append({ evidenceIds: [] })).trust).toBe('UNVERIFIED');
    expect(juliusAdmittedClaimFor(append({ kind: 'HANDOFF', evidenceIds: [] })).trust).toBe('UNVERIFIED');
    expect(juliusAdmittedClaimFor(append({ kind: 'DECISION', workerId: 'julius' })).trust).toBe('APPROVED');
  });

  it('keys a standing on its content, so a replay is the same standing and a promotion is not', () => {
    const claim = juliusAdmittedClaimFor(append());
    expect(juliusClaimStandingKey(claim)).toBe(juliusClaimStandingKey({ ...claim }));
    expect(juliusClaimStandingKey(claim)).not.toBe(juliusClaimStandingKey({ ...claim, trust: 'VERIFIED' }));
    expect(juliusClaimStandingKey(claim)).not.toBe(juliusClaimStandingKey({ ...claim, evidence: [...claim.evidence, { kind: 'REVIEW', id: 'r' }] }));
    expect(JULIUS_CLAIM_LEDGER_VERSION).toBe('julius-claim-ledger.v1');
  });
});

describe('promotion on an accepted review', () => {
  const coderEntry = append();
  const otherTaskEntry = append({ entryId: 'entry:other', taskId: 'plan-1', workerId: 'architect', kind: 'HANDOFF', evidenceIds: [] });
  const claims = [juliusAdmittedClaimFor(coderEntry), juliusAdmittedClaimFor(otherTaskEntry)];
  const entries = [entryOf(coderEntry), entryOf(otherTaskEntry)];
  const at = '2026-09-27T11:00:00.000Z';

  it('promotes the reviewed task’s entries to VERIFIED on the review’s evidence, and nothing else', () => {
    const outcome = juliusClaimPromotionsOnAccept({
      claims, entries, subjectTaskId: 'build-1', by: 'reviewer', reviewEvidenceIds: ['evidence:review-1'], at,
    });
    expect(outcome.promoted.map((p) => [p.claim.claimId, p.from, p.claim.trust])).toEqual([[juliusClaimIdFor('entry:evidence-1'), 'SUPPORTED', 'VERIFIED']]);
    expect(outcome.promoted[0]!.claim.evidence).toEqual([{ kind: 'EVIDENCE', id: 'evidence:test-1' }, { kind: 'REVIEW', id: 'evidence:review-1' }]);
    expect(outcome.refused).toEqual([]);
  });

  it('refuses, by name, a reviewer who is the asserter — self-verification is not a promotion', () => {
    const outcome = juliusClaimPromotionsOnAccept({
      claims, entries, subjectTaskId: 'build-1', by: 'coder', reviewEvidenceIds: ['evidence:review-1'], at,
    });
    expect(outcome.promoted).toEqual([]);
    expect(outcome.refused).toEqual([{ claimId: juliusClaimIdFor('entry:evidence-1'), reasonCode: 'memory_self_verification' }]);
  });

  it('refuses a review that cites nothing: no evidence, no standing', () => {
    const outcome = juliusClaimPromotionsOnAccept({ claims, entries, subjectTaskId: 'build-1', by: 'reviewer', reviewEvidenceIds: [], at });
    expect(outcome.promoted).toEqual([]);
    expect(outcome.refused[0]!.reasonCode).toBe('memory_evidence_insufficient_for_verified');
  });

  it('skips what is already at or above VERIFIED, and what is terminal, without a refusal', () => {
    const verified: JuliusMemoryClaim = { ...claims[0]!, trust: 'VERIFIED' };
    const dead: JuliusMemoryClaim = { ...claims[0]!, claimId: 'claim:dead', entryId: 'entry:dead', trust: 'SUPERSEDED' };
    const deadEntry = { ...entries[0]!, entryId: 'entry:dead' };
    const outcome = juliusClaimPromotionsOnAccept({
      claims: [verified, dead], entries: [...entries, deadEntry], subjectTaskId: 'build-1', by: 'reviewer', reviewEvidenceIds: ['e'], at,
    });
    expect(outcome.promoted).toEqual([]);
    expect(outcome.refused).toEqual([]);
  });

  it('promotes an UNVERIFIED entry straight to VERIFIED: the ladder is what the evidence justifies, not one rung per review', () => {
    const handoff = append({ entryId: 'entry:handoff', kind: 'HANDOFF', evidenceIds: [] });
    const outcome = juliusClaimPromotionsOnAccept({
      claims: [juliusAdmittedClaimFor(handoff)], entries: [entryOf(handoff)],
      subjectTaskId: 'build-1', by: 'reviewer', reviewEvidenceIds: ['evidence:review-1'], at,
    });
    expect(outcome.promoted.map((p) => [p.from, p.claim.trust])).toEqual([['UNVERIFIED', 'VERIFIED']]);
  });
});

describe('the record wins at compile', () => {
  it('replaces the derived claim with the recorded one for the same claim id, and leaves every other claim and field alone', () => {
    const inputs = [append(), append({ entryId: 'entry:handoff', kind: 'HANDOFF', evidenceIds: [] })];
    const qualification = deriveJuliusContextQualification(inputs.map(entryOf));
    const recorded: JuliusMemoryClaim = { ...qualification.claims[0]!, trust: 'VERIFIED', evidence: [...qualification.claims[0]!.evidence, { kind: 'REVIEW', id: 'r' }] };
    const merged = mergeJuliusDurableStanding(qualification, [recorded]);
    expect(merged.claims[0]).toEqual(recorded);
    expect(merged.claims[1]).toEqual(qualification.claims[1]);
    expect(merged.contextTypes).toBe(qualification.contextTypes);
    expect(merged.recordedAt).toBe(qualification.recordedAt);
    expect(merged.contractEntryIds).toBe(qualification.contractEntryIds);
  });

  it('is the identity when nothing was recorded, so a run before the ledger existed compiles exactly as it did', () => {
    const qualification = deriveJuliusContextQualification([entryOf(append())]);
    expect(mergeJuliusDurableStanding(qualification, [])).toBe(qualification);
    // A recorded claim for an entry NOT in this packet changes nothing either.
    const stranger: JuliusMemoryClaim = { ...qualification.claims[0]!, claimId: 'claim:elsewhere', entryId: 'entry:elsewhere' };
    expect(mergeJuliusDurableStanding(qualification, [stranger]).claims).toEqual(qualification.claims);
  });
});

/* ═══════════════════════════════════════════════════ THE CARRY, CORRECTED (founder ruling 2026-10-04) */

/**
 * THE CORRECTED CARRY, HELD TO THE FOUNDER'S RULING. The first carry handed a
 * new run every VERIFIED/APPROVED claim of the project, and a DECISION is
 * APPROVED by its kind: so a verdict about another run's task and an
 * architecture nobody accepted arrived as approved instructions, run-wide,
 * while the reviewer's real finding never travelled. These cases pin the rule
 * that replaced it, from inputs built with the runtime's own id minting
 * (`juliusArchitectureEntryId`, `juliusArchitectureProposalEntryId`, and the
 * pipeline's `brain:decision:<task>:<action>:<reason>` mirror).
 */

const NEW_RUN = 'run:new';
const SRC = 'run:src';
const OLD = 'run:old';
const LIVE = 'run:live';
const SCOPE: JuliusCarryScope = { taskId: `${NEW_RUN}:plan`, taskType: 'plan', role: 'PROMPT_ARCHITECT' };
const REVIEWER = 'independent-reviewer-hermes';
const ARCHITECT = 'prompt-architect-openai';
const SENTINEL = 'CARRY-SENTINEL the plan deploys before the migration runs';

const RESOLVED = {
  originReviewTaskId: `review:${SRC}:plan`, state: 'RESOLVED' as const, lastMove: 'REVIEWER_RESOLVED' as const,
  repairTaskIds: [`repair:${SRC}:plan:1:task`], resolutionReviewTaskId: `review:repair:${SRC}:plan:1:task`,
};
const OPEN = { originReviewTaskId: `review:${SRC}:plan`, state: 'OPEN' as const, lastMove: null, repairTaskIds: [], resolutionReviewTaskId: null };

const findingOf = (over: Partial<JuliusCarryFindingCandidate['finding']> = {}): JuliusCarryFindingCandidate['finding'] => ({
  findingId: 'finding:evidence:1', taskId: `${SRC}:plan`, reviewerWorkerId: REVIEWER, severity: 'HIGH', category: 'review',
  claim: SENTINEL, criterionId: 'AC-1', evidenceIds: ['evidence:1'], blocking: true, status: 'OPEN', createdAt: '2026-10-04T10:00:00.000Z', ...over,
});

/** The tasks a product-path life names, as the run's rows hold them (the review that raised it, the repair, the re-review). */
const LIVED = {
  origin: { taskType: 'review:plan', state: 'SUCCEEDED' },
  repairs: [{ taskType: 'repair:plan', state: 'SUCCEEDED' }],
  resolution: { taskType: 'review:repair:plan', state: 'SUCCEEDED' },
};

const candidateOf = (over: {
  readonly runId?: string;
  readonly finding?: Partial<JuliusCarryFindingCandidate['finding']>;
  readonly life?: JuliusCarryFindingCandidate['life'];
  readonly lifeTasks?: JuliusCarryFindingCandidate['lifeTasks'];
} = {}): JuliusCarryFindingCandidate => {
  const life = over.life === undefined ? RESOLVED : over.life;
  return {
    runId: over.runId ?? SRC,
    finding: findingOf(over.finding),
    life,
    task: { taskType: 'plan', role: 'PROMPT_ARCHITECT' },
    lifeTasks: over.lifeTasks !== undefined ? over.lifeTasks : life === null ? null : LIVED,
  };
};

const standing = (entryId: string, trust: JuliusMemoryClaim['trust'], assertedBy: string): JuliusMemoryClaim => ({
  claimId: juliusClaimIdFor(entryId), entryId, provenance: 'run_observed', trust, assertedBy,
  assertedAt: '2026-10-04T09:00:00.000Z', evidence: [], supersedes: null, contradicts: [],
});

const rowOf = (runId: string, entryId: string, over: Partial<JuliusCarryBrainCandidate> = {}): JuliusCarryBrainCandidate => ({
  runId, entryId, kind: 'DECISION', taskId: null, workerId: ARCHITECT,
  text: `ACCEPTED ARCHITECTURE (revision n) of ${runId}`, evidenceIds: [], claim: standing(entryId, 'APPROVED', ARCHITECT), ...over,
});

const designOf = (runId: string, revision: number | null): JuliusCarryArchitectureFact => ({
  runId, inForceEntryId: revision === null ? null : juliusArchitectureEntryId(runId, revision),
  revision, proposedByTaskId: revision === null ? null : `${runId}:plan`,
});

const RUNS: readonly JuliusCarrySourceRun[] = [
  { runId: LIVE, state: 'EXECUTING' }, { runId: SRC, state: 'COMPLETED' }, { runId: OLD, state: 'COMPLETED' },
];

const plan = (over: Partial<Parameters<typeof planJuliusKnowledgeCarry>[0]> = {}) => planJuliusKnowledgeCarry({
  runId: NEW_RUN, projectId: 'prj-1', missionId: 'mission-1', scope: SCOPE, sourceRuns: RUNS,
  findings: [], architectures: [], brain: [], limit: 12, ...over,
});

const reasonsOf = (result: ReturnType<typeof plan>) =>
  Object.fromEntries(result.excluded.map((item) => [`${item.sourceRunId} ${item.sourceRef}`, item.reason]));

describe('the corrected carry: a DECISION is not knowledge because of its kind', () => {
  it('excludes, by name, every verification-verdict mirror and every PROPOSED architecture, and carries none of them', () => {
    const repairMirror = `brain:decision:${SRC}:plan:REPAIR:BLOCKING_FINDINGS`;
    const acceptMirror = `brain:decision:${SRC}:build:ACCEPT:TASK_VERIFIED`;
    const proposal = juliusArchitectureProposalEntryId(`${SRC}:architecture:1`);
    const result = plan({
      architectures: [designOf(SRC, null)],
      brain: [
        rowOf(SRC, repairMirror, { taskId: `${SRC}:plan`, text: 'REPAIR (BLOCKING_FINDINGS): Verification requires repair.', workerId: REVIEWER }),
        rowOf(SRC, acceptMirror, { taskId: `${SRC}:build`, text: 'ACCEPT (TASK_VERIFIED): Required evidence passed.', workerId: REVIEWER }),
        rowOf(SRC, proposal, { taskId: `${SRC}:architecture:1`, text: 'PROPOSED ARCHITECTURE REVISION — NOT IN FORCE.' }),
      ],
    });
    expect(result.carried, 'an APPROVED standing earned by kind alone carries nothing').toEqual([]);
    expect(reasonsOf(result)).toEqual({
      [`${SRC} ${repairMirror}`]: 'decision_mirror',
      [`${SRC} ${acceptMirror}`]: 'decision_mirror',
      [`${SRC} ${proposal}`]: 'architecture_proposal',
    });
  });
});

describe('the corrected carry: the design is not a source (Decision C; SECOND ruling (b))', () => {
  it('carries no design — not even the APPROVED revision in force when the newest COMPLETED run ended — and names every one', () => {
    const live = juliusArchitectureEntryId(LIVE, 1);
    const superseded = juliusArchitectureEntryId(SRC, 1);
    const inForce = juliusArchitectureEntryId(SRC, 2);
    const older = juliusArchitectureEntryId(OLD, 1);
    const result = plan({
      architectures: [designOf(LIVE, 1), designOf(SRC, 2), designOf(OLD, 1)],
      brain: [rowOf(LIVE, live), rowOf(SRC, superseded), rowOf(SRC, inForce, { text: 'ACCEPTED ARCHITECTURE (revision 2) — the design' }), rowOf(OLD, older)],
    });
    expect(result.carried, 'the design in force, APPROVED, is the one draft r1 carried').toEqual([]);
    expect(result.eligible).toBe(0);
    expect(reasonsOf(result)).toEqual({
      [`${LIVE} ${live}`]: 'architecture_run_not_completed',
      [`${SRC} ${superseded}`]: 'architecture_not_in_force',
      [`${SRC} ${inForce}`]: 'architecture_not_a_source',
      [`${OLD} ${older}`]: 'architecture_older_run',
    });
    expect(result.carried.length + result.excluded.length).toBe(result.candidates);
  });

  it('a design beside a verified repair finding stays behind: the finding is the only row that travels', () => {
    const inForce = juliusArchitectureEntryId(SRC, 2);
    const result = plan({ architectures: [designOf(SRC, 2)], brain: [rowOf(SRC, inForce)], findings: [candidateOf()] });
    expect(result.carried.map((item) => [item.source, item.sourceRef])).toEqual([['VERIFIED_REPAIR_FINDING', 'finding:evidence:1']]);
    expect(reasonsOf(result)).toEqual({ [`${SRC} ${inForce}`]: 'architecture_not_a_source' });
  });

  it('names a design in force that holds no APPROVED standing instead of carrying it, and counts it as looked at', () => {
    const inForce = juliusArchitectureEntryId(SRC, 2);
    const verifiedOnly = plan({ architectures: [designOf(SRC, 2)], brain: [rowOf(SRC, inForce, { claim: standing(inForce, 'VERIFIED', ARCHITECT) })] });
    expect(verifiedOnly.carried).toEqual([]);
    expect(reasonsOf(verifiedOnly)).toEqual({ [`${SRC} ${inForce}`]: 'architecture_standing_not_approved' });
    const unrecorded = plan({ architectures: [designOf(SRC, 2)], brain: [] });
    expect(unrecorded.carried).toEqual([]);
    expect(reasonsOf(unrecorded)).toEqual({ [`${SRC} ${inForce}`]: 'architecture_standing_not_approved' });
    expect(unrecorded.candidates, 'the design the ledger named was looked at').toBe(1);
    const notADecision = plan({ architectures: [designOf(SRC, 2)], brain: [rowOf(SRC, inForce, { kind: 'HANDOFF' })] });
    expect(notADecision.carried, 'only the DECISION row the runtime wrote is the design').toEqual([]);
  });
});

describe('the corrected carry: verified reviewer findings', () => {
  it('carries only a blocking, cited finding that a repair ADDRESSED and an independent re-review RESOLVED', () => {
    const result = plan({
      findings: [
        candidateOf(),
        candidateOf({ finding: { findingId: 'finding:open' }, life: OPEN }),
        candidateOf({ finding: { findingId: 'finding:addressed' }, life: { ...RESOLVED, state: 'ADDRESSED', lastMove: 'REPAIR_SUCCEEDED', resolutionReviewTaskId: null } }),
        candidateOf({ finding: { findingId: 'finding:maintained' }, life: { ...RESOLVED, state: 'OPEN', lastMove: 'REVIEWER_MAINTAINED', resolutionReviewTaskId: null } }),
        candidateOf({ finding: { findingId: 'finding:superseded' }, life: { ...RESOLVED, state: 'SUPERSEDED', lastMove: 'REVIEWER_SUPERSEDED', resolutionReviewTaskId: null } }),
        candidateOf({ finding: { findingId: 'finding:warning', blocking: false } }),
        candidateOf({ finding: { findingId: 'finding:uncited', evidenceIds: [] } }),
        candidateOf({ finding: { findingId: 'finding:no-repair' }, life: { ...RESOLVED, repairTaskIds: [] } }),
        candidateOf({ finding: { findingId: 'finding:unreadable' }, life: null }),
        // REJECTED: a DISMISSED row never travels, even with a life that reads RESOLVED (C-5, by name).
        candidateOf({ finding: { findingId: 'finding:dismissed', status: 'DISMISSED' } }),
        // UNPROVENANCED: resolved and repaired, but no review is on record as raising it.
        candidateOf({ finding: { findingId: 'finding:origin-unknown' }, life: { ...RESOLVED, originReviewTaskId: null } }),
      ],
    });
    expect(result.carried.map((item) => item.sourceRef)).toEqual(['finding:evidence:1']);
    expect(reasonsOf(result)).toEqual({
      [`${SRC} finding:dismissed`]: 'finding_dismissed',
      [`${SRC} finding:origin-unknown`]: 'finding_origin_unknown',
      [`${SRC} finding:open`]: 'finding_unresolved',
      [`${SRC} finding:addressed`]: 'finding_unresolved',
      [`${SRC} finding:maintained`]: 'finding_unresolved',
      [`${SRC} finding:superseded`]: 'finding_superseded',
      [`${SRC} finding:warning`]: 'finding_not_blocking',
      [`${SRC} finding:uncited`]: 'finding_uncited',
      [`${SRC} finding:no-repair`]: 'finding_resolved_without_repair',
      [`${SRC} finding:unreadable`]: 'finding_lifecycle_unreadable',
    });
  });

  it('carries a resolved finding only when the review that raised it, every repair and the re-review that resolved it are real, finished tasks of its run (P2b)', () => {
    const forged = (findingId: string, lifeTasks: JuliusCarryFindingCandidate['lifeTasks']) => candidateOf({ finding: { findingId }, lifeTasks });
    const result = plan({
      findings: [
        candidateOf(),
        forged('finding:origin-not-a-task', { ...LIVED, origin: null }),
        forged('finding:origin-not-a-review', { ...LIVED, origin: { taskType: 'plan', state: 'SUCCEEDED' } }),
        forged('finding:repair-not-a-task', { ...LIVED, repairs: [null] }),
        forged('finding:repair-failed', { ...LIVED, repairs: [{ taskType: 'repair:plan', state: 'FAILED' }] }),
        forged('finding:one-repair-not-a-task', { ...LIVED, repairs: [LIVED.repairs[0]!, null] }),
        forged('finding:resolution-not-a-task', { ...LIVED, resolution: null }),
        forged('finding:resolution-unfinished', { ...LIVED, resolution: { taskType: 'review:repair:plan', state: 'ACTIVE' } }),
        forged('finding:resolution-not-a-review', { ...LIVED, resolution: { taskType: 'repair:plan', state: 'SUCCEEDED' } }),
      ],
    });
    expect(result.carried.map((item) => item.sourceRef), 'only the finding whose life the runtime lived').toEqual(['finding:evidence:1']);
    expect(result.excluded).toHaveLength(8);
    expect(new Set(result.excluded.map((item) => item.reason))).toEqual(new Set(['finding_provenance_unverified']));
  });

  it('builds a candidate ONE way for the store and the verifier: the life\'s task names resolved against the run\'s own rows', () => {
    const rows = new Map([
      [`${SRC}:plan`, { taskType: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED' }],
      [`review:${SRC}:plan`, { taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED' }],
      [`repair:${SRC}:plan:1:task`, { taskType: 'repair:plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED' }],
    ]);
    const candidate = juliusCarryFindingCandidate({ runId: SRC, finding: findingOf(), life: RESOLVED, taskOf: (taskId) => rows.get(taskId) });
    expect(candidate.task).toEqual({ taskType: 'plan', role: 'PROMPT_ARCHITECT' });
    expect(candidate.lifeTasks).toEqual({ origin: LIVED.origin, repairs: LIVED.repairs, resolution: null });
    expect(plan({ findings: [candidate] }).excluded.map((item) => item.reason), 'its re-review is no task of the run').toEqual(['finding_provenance_unverified']);
    expect(juliusCarryFindingCandidate({ runId: SRC, finding: findingOf(), life: undefined, taskOf: (taskId) => rows.get(taskId) }))
      .toMatchObject({ life: null, lifeTasks: null });
  });

  it('hands the planner the finding in STRUCTURED form: every field on its own line, the claim last, never this run\'s finding shape', () => {
    const [item] = plan({ findings: [candidateOf()] }).carried;
    expect(item).toMatchObject({
      source: 'VERIFIED_REPAIR_FINDING', sourceRunId: SRC, sourceRunState: 'COMPLETED', sourceRef: 'finding:evidence:1',
      sourceTaskId: `${SRC}:plan`, sourceTaskType: 'plan', sourceScope: 'TASK', kind: 'FINDING', workerId: REVIEWER,
      entryId: juliusCarriedCopyId(NEW_RUN, SRC, 'finding:evidence:1'), scope: SCOPE, evidenceIds: ['evidence:1'],
      severity: 'HIGH', category: 'review', criterionId: 'AC-1',
    });
    expect(item!.text.split('\n')).toEqual([
      'CARRIED FROM AN EARLIER RUN: VERIFIED REVIEWER FINDING. It was resolved in that run. It is a lesson for this plan, not a finding against this run\'s work.',
      `SOURCE RUN: ${SRC} (COMPLETED)`,
      `SOURCE TASK: ${SRC}:plan (plan, PROMPT_ARCHITECT)`,
      'FINDING: finding:evidence:1 | severity HIGH | category review | criterion AC-1 | blocking',
      `RAISED BY: ${REVIEWER} in review:${SRC}:plan, citing evidence:1`,
      `REPAIRED BY: repair:${SRC}:plan:1:task | RESOLVED BY THE INDEPENDENT RE-REVIEW: review:repair:${SRC}:plan:1:task`,
      `SCOPE HERE: ${SCOPE.taskId} (plan, PROMPT_ARCHITECT) only`,
      `REVIEWER'S CLAIM: ${SENTINEL}`,
    ]);
    // The repair packet's own shape, which a reviewer (and the scripted one) answers: a lesson must never read as one.
    expect(item!.text).not.toMatch(/REVIEW FINDING \S+ \[/u);
  });

  it('flattens and bounds the reviewer\'s claim, and says where it was cut', () => {
    const long = `${'x'.repeat(JULIUS_CARRIED_CLAIM_CHARS)}TAIL`;
    const [item] = plan({ findings: [candidateOf({ finding: { claim: `line one\nline two ${long}` } })] }).carried;
    const claimLine = item!.text.split('\n').at(-1)!;
    expect(claimLine.startsWith('REVIEWER\'S CLAIM: line one line two ')).toBe(true);
    expect(claimLine).not.toContain('TAIL');
    expect(claimLine.endsWith(`[cut at ${String(JULIUS_CARRIED_CLAIM_CHARS)} characters]`)).toBe(true);
  });

  it('records the copy\'s standing exactly as admission derives a cited FINDING: VERIFIED, the reviewer as asserter, when the reviewer said it', () => {
    const [item] = plan({ findings: [candidateOf()] }).carried;
    expect(item!.claim).toEqual(juliusAdmittedClaimFor({
      runId: NEW_RUN, projectId: 'prj-1', taskId: SCOPE.taskId, workerId: REVIEWER, entryId: item!.entryId, kind: 'FINDING',
      safeText: '', evidenceIds: ['evidence:1'], occurredAt: '2026-10-04T10:00:00.000Z',
    }));
    expect(item!.claim).toMatchObject({ trust: 'VERIFIED', provenance: 'reviewer_verified', assertedBy: REVIEWER, claimId: juliusClaimIdFor(item!.entryId) });
  });
});

describe('the corrected carry: scope, sources and order', () => {
  it('scopes every carried row to the new run\'s plan: task-scoped stays task-scoped, nothing is widened, and the run-wide design stays behind', () => {
    const inForce = juliusArchitectureEntryId(SRC, 2);
    const result = plan({
      findings: [candidateOf(), candidateOf({ finding: { findingId: 'finding:build', taskId: `${SRC}:build` } })],
      architectures: [designOf(SRC, 2)], brain: [rowOf(SRC, inForce)],
    });
    expect(result.carried).toHaveLength(2);
    for (const item of result.carried) {
      expect(item.scope, item.entryId).toEqual(SCOPE);
      expect(item.text, item.entryId).toContain(`SCOPE HERE: ${SCOPE.taskId} (plan, PROMPT_ARCHITECT) only`);
    }
    expect(result.carried.map((item) => [item.sourceTaskId, item.sourceScope])).toEqual([[`${SRC}:build`, 'TASK'], [`${SRC}:plan`, 'TASK']]);
    expect(reasonsOf(result)).toEqual({ [`${SRC} ${inForce}`]: 'architecture_not_a_source' });
  });

  it('never treats a copy as a source, and leaves task-scoped and run-wide material behind by name', () => {
    const copy = juliusCarriedCopyId(SRC, OLD, 'finding:evidence:0');
    const handoff = `brain:guidance-answer:segment:${SRC}:build:1:task:r1`;
    const artifact = `brain:research-served:${SRC}:1`;
    const result = plan({
      architectures: [designOf(SRC, null)],
      brain: [
        rowOf(SRC, copy, { kind: 'FINDING', workerId: REVIEWER, claim: standing(copy, 'VERIFIED', REVIEWER) }),
        rowOf(SRC, handoff, { kind: 'HANDOFF', taskId: `segment:${SRC}:build:1:task`, claim: standing(handoff, 'VERIFIED', ARCHITECT) }),
        rowOf(SRC, artifact, { kind: 'ARTIFACT', claim: standing(artifact, 'VERIFIED', 'julius') }),
      ],
    });
    expect(result.carried).toEqual([]);
    expect(reasonsOf(result)).toEqual({
      [`${SRC} ${copy}`]: 'carried_copy',
      [`${SRC} ${handoff}`]: 'task_scoped_entry',
      [`${SRC} ${artifact}`]: 'entry_kind_not_carried',
    });
  });

  it('never carries from the run doing the carrying, and reads only the runs it was given', () => {
    const result = plan({
      sourceRuns: [{ runId: NEW_RUN, state: 'COMPLETED' }, { runId: SRC, state: 'COMPLETED' }],
      findings: [candidateOf({ runId: NEW_RUN, finding: { findingId: 'finding:self' } }), candidateOf({ runId: 'run:stranger', finding: { findingId: 'finding:stranger' } }), candidateOf()],
    });
    expect(result.sourceRunIds).toEqual([SRC]);
    expect(result.carried.map((item) => item.sourceRef)).toEqual(['finding:evidence:1']);
    expect(result.candidates, 'what is not a source is not even a candidate').toBe(1);
  });

  it('orders newest run first, most severe first — and names what the bound left behind', () => {
    const inForce = juliusArchitectureEntryId(SRC, 2);
    const result = plan({
      limit: 2,
      architectures: [designOf(SRC, 2)],
      brain: [rowOf(SRC, inForce)],
      findings: [
        candidateOf({ runId: OLD, finding: { findingId: 'finding:old-critical', severity: 'CRITICAL' } }),
        candidateOf({ finding: { findingId: 'finding:medium', severity: 'MEDIUM' } }),
        candidateOf({ finding: { findingId: 'finding:critical', severity: 'CRITICAL' } }),
        candidateOf({ finding: { findingId: 'finding:high', severity: 'HIGH' } }),
      ],
    });
    expect(result.carried.map((item) => item.sourceRef)).toEqual(['finding:critical', 'finding:high']);
    expect(result.eligible).toBe(4);
    expect(reasonsOf(result)).toEqual({
      [`${SRC} ${inForce}`]: 'architecture_not_a_source',
      [`${SRC} finding:medium`]: 'over_limit',
      [`${OLD} finding:old-critical`]: 'over_limit',
    });
  });

  it('accounts for everything it looked at: every candidate is carried or excluded', () => {
    const inForce = juliusArchitectureEntryId(SRC, 2);
    const result = plan({
      architectures: [designOf(SRC, 2), designOf(LIVE, 1)],
      brain: [rowOf(SRC, inForce), rowOf(SRC, `brain:decision:${SRC}:plan:ACCEPT:TASK_VERIFIED`, { taskId: `${SRC}:plan` }), rowOf(LIVE, juliusArchitectureEntryId(LIVE, 1))],
      findings: [candidateOf(), candidateOf({ finding: { findingId: 'finding:open' }, life: OPEN })],
    });
    expect(result.carried.length + result.excluded.length).toBe(result.candidates);
    expect(result.version).toBe(JULIUS_KNOWLEDGE_CARRY_VERSION);
  });

  it('writes each copy under an id unique to the run that inherits it, stable on replay, and still a carried id', () => {
    const a = juliusCarriedCopyId(NEW_RUN, SRC, 'finding:evidence:1');
    expect(a).toBe(juliusCarriedCopyId(NEW_RUN, SRC, 'finding:evidence:1'));
    expect(a, 'two heirs of one source must not share a primary key').not.toBe(juliusCarriedCopyId('run:other-heir', SRC, 'finding:evidence:1'));
    expect(isJuliusCarriedEntryId(a)).toBe(true);
    expect(a.startsWith(`carried:${SRC}:`), 'the source still leads the id').toBe(true);
  });
});

describe('the corrected carry, on the record', () => {
  const mixed = () => {
    const inForce = juliusArchitectureEntryId(SRC, 2);
    return plan({
      architectures: [designOf(SRC, 2)],
      brain: [rowOf(SRC, inForce), rowOf(SRC, `brain:decision:${SRC}:plan:REPAIR:BLOCKING_FINDINGS`, { taskId: `${SRC}:plan` })],
      findings: [candidateOf(), candidateOf({ finding: { findingId: 'finding:open' }, life: OPEN })],
    });
  };

  it('names every carried row and every exclusion by reason, in tokens and digests only, and is a valid ledger event', () => {
    const result = mixed();
    const digests = Object.fromEntries(result.carried.map((item, index) => [item.entryId, `sha256:${String(index).repeat(16)}`]));
    const facts = juliusKnowledgeCarryFacts(result, digests);
    expect(facts).toMatchObject({
      carryVersion: JULIUS_KNOWLEDGE_CARRY_VERSION, outcome: 'CARRIED', reasonCode: null, scopeTaskId: SCOPE.taskId, scopeRole: 'PROMPT_ARCHITECT',
      sourceRuns: 3, candidates: 4, eligible: 1, carried: 1, carriedFindings: 1, carriedArchitecture: 0, excluded: 3,
      excludedByReason: 'finding_unresolved=1,architecture_not_a_source=1,decision_mirror=1',
    });
    expect(String(facts.carriedEntries), 'the one row is the finding').toMatch(/^[^;]*\|FINDING\|VERIFIED_REPAIR_FINDING\|[^;]*$/u);
    for (const item of result.carried) {
      expect(facts.carriedEntries, item.entryId).toContain(item.entryId);
      expect(facts.carriedEntries, item.entryId).toContain(digests[item.entryId]!);
    }
    expect(JSON.stringify(facts), 'a finding\'s text never reaches the ledger').not.toContain('CARRY-SENTINEL');
    const event = juliusKnowledgeCarriedEvent({ runId: NEW_RUN, projectId: 'prj-1', eventId: 'e-1', facts, occurredAt: '2026-10-04T11:00:00.000Z' });
    expect(event).toMatchObject({ type: 'knowledge.carried', taskId: null, workerId: null, correlationId: `knowledge-carry:${NEW_RUN}` });
    expect(() => validateJuliusEvent(event)).not.toThrow();
  });

  it('says EMPTY, with its exclusions, when nothing qualified', () => {
    const facts = juliusKnowledgeCarryFacts(plan({ brain: [rowOf(SRC, `brain:decision:${SRC}:plan:ACCEPT:TASK_VERIFIED`, { taskId: `${SRC}:plan` })] }), {});
    expect(facts).toMatchObject({ outcome: 'EMPTY', carried: 0, excluded: 1, excludedByReason: 'decision_mirror=1', carriedEntries: null });
  });

  it('stays a valid event at the bound: twelve long rows and five hundred exclusions', () => {
    const findings = Array.from({ length: 20 }, (_, index) => candidateOf({ finding: { findingId: `finding:${'f'.repeat(120)}:${String(index)}` } }));
    const brain = Array.from({ length: 500 }, (_, index) => rowOf(SRC, `brain:decision:${SRC}:${'t'.repeat(60)}:${String(index)}:ACCEPT:TASK_VERIFIED`, { taskId: `${SRC}:plan` }));
    const result = plan({ findings, brain, brainTruncated: true });
    const facts = juliusKnowledgeCarryFacts(result, Object.fromEntries(result.carried.map((item) => [item.entryId, `sha256:${'a'.repeat(16)}`])));
    expect(result.carried).toHaveLength(12);
    expect(facts.candidatesTruncated, 'a bounded read says its count is a lower bound').toBe(true);
    expect(JSON.stringify(facts).length).toBeLessThan(8_192);
    expect(facts.entriesTruncated === true || facts.excludedRefsTruncated === true, 'the bound was really reached').toBe(true);
    expect(() => validateJuliusEvent(juliusKnowledgeCarriedEvent({ runId: NEW_RUN, projectId: 'prj-1', eventId: 'e-2', facts, occurredAt: 't' }))).not.toThrow();
  });

  it('withholds one row\'s token rather than lose the event when a value is shaped like a secret', () => {
    const facts = juliusKnowledgeCarryFacts(plan({ findings: [candidateOf({ finding: { category: 'token: hunter2' } })] }), {});
    expect(String(facts.carriedEntries)).toContain('withheld');
    expect(() => validateJuliusEvent(juliusKnowledgeCarriedEvent({ runId: NEW_RUN, projectId: 'prj-1', eventId: 'e-3', facts, occurredAt: 't' }))).not.toThrow();
  });

  it('records a failure with its closed reason, and every count it never made as unknown rather than zero', () => {
    const facts = juliusKnowledgeCarryFailureFacts({ missionId: 'mission-1', scopeTaskId: SCOPE.taskId, reasonCode: 'carry_write_failed' });
    expect(facts).toMatchObject({ outcome: 'FAILED', reasonCode: 'carry_write_failed', carried: null, candidates: null, excluded: null });
    expect(() => validateJuliusEvent(juliusKnowledgeCarriedEvent({ runId: NEW_RUN, projectId: 'prj-1', eventId: 'e-4', facts, occurredAt: 't' }))).not.toThrow();
    expect(JULIUS_CARRY_EXCLUSIONS, 'the vocabulary is closed and duplicate-free').toHaveLength(new Set(JULIUS_CARRY_EXCLUSIONS).size);
  });

  it('records what a packet was owed against what it was handed, and nothing for a packet owed nothing', () => {
    const owed = [juliusCarriedCopyId(NEW_RUN, SRC, 'finding:evidence:1'), juliusCarriedCopyId(NEW_RUN, SRC, 'finding:evidence:2')];
    expect(juliusKnowledgeConsumedFacts({ owed: [], sourceEntryIds: [], evictedEntryIds: [], excludedEntryIds: [], attempt: 1, role: 'PROMPT_ARCHITECT', taskType: 'plan' })).toBeNull();
    const facts = juliusKnowledgeConsumedFacts({
      owed, sourceEntryIds: ['x', owed[0]!], evictedEntryIds: [owed[1]!], excludedEntryIds: [], attempt: 2, role: 'PROMPT_ARCHITECT', taskType: 'plan',
    });
    expect(facts).toMatchObject({ inScope: 2, admitted: 1, admittedEntryIds: owed[0], evicted: 1, evictedEntryIds: owed[1], excludedInScope: 0, missing: 1, attempt: 2 });
  });
});
