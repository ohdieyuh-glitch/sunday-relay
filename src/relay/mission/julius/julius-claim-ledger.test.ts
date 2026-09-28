import { describe, expect, it } from 'vitest';

import {
  JULIUS_CLAIM_LEDGER_VERSION, juliusAdmittedClaimFor, juliusClaimIdFor, juliusClaimPromotionsOnAccept,
  juliusClaimStandingKey, mergeJuliusDurableStanding,
} from './julius-claim-ledger';
import { deriveJuliusContextQualification } from './julius-context-provenance';
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
