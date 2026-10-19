import { describe, expect, it } from 'vitest';

import {
  JULIUS_MEMORY_PROVENANCE,
  JULIUS_MEMORY_TRUST_STATES,
  admitJuliusMemoryCandidate,
  contradictJuliusMemoryClaims,
  promoteJuliusMemoryClaim,
  retrieveTrustedJuliusMemory,
  supersedeJuliusMemoryClaim,
  type JuliusMemoryClaim,
  type JuliusMemoryOutcome,
  type JuliusMemoryTrustState,
} from './julius-memory-trust';

/**
 * PROJECT BRAIN v2 TRUST CORE — THE SPECIFICATION.
 *
 * The rule the whole module exists to hold: AUTO-GENERATE IS ALLOWED,
 * AUTO-TRUST IS NOT. Julius may derive a memory candidate from anything it
 * observes; nothing becomes trusted except by verification from an authority
 * that is not the thing being verified.
 *
 * PROVENANCE OF THIS FILE. Cases 1-10 are the specification seeded for paid
 * Live Mission 4 (`.github/julius-missions/julius-live-mission-4/seed/`), ported
 * from `node:test` to this repository's runner with the assertions unchanged, so
 * what the paid mission would have been graded on is what `npm test` now holds.
 * Everything under "beyond the seeded specification" is additional: the seed is
 * a floor, and three of the invariants the module's own prose claims were not
 * covered by it at all.
 */

const AT = '2026-09-10T02:00:00.000Z';
const LATER = '2026-09-10T06:00:00.000Z';

const ok = <T>(outcome: JuliusMemoryOutcome<T>): T => {
  expect(outcome.outcome, `expected OK, got ${JSON.stringify(outcome)}`).toBe('OK');
  if (outcome.outcome !== 'OK') throw new Error('unreachable');
  return outcome.claim;
};

const refusal = (outcome: JuliusMemoryOutcome<unknown>, reasonCode?: string): string => {
  expect(outcome.outcome, `expected REFUSED, got ${JSON.stringify(outcome)}`).toBe('REFUSED');
  if (outcome.outcome !== 'REFUSED') throw new Error('unreachable');
  if (reasonCode !== undefined) expect(outcome.reasonCode).toBe(reasonCode);
  return outcome.reasonCode;
};

const candidate = (over: Partial<Parameters<typeof admitJuliusMemoryCandidate>[0]> = {}): JuliusMemoryClaim =>
  ok(admitJuliusMemoryCandidate({
    claimId: 'claim-1', entryId: 'entry-1', provenance: 'run_observed',
    assertedBy: 'coding-agent-claude-hosted', assertedAt: AT, ...over,
  }));

const REVIEWER = 'independent-reviewer-hermes';

describe('the Project Brain v2 trust core', () => {
  it('closes and completes both vocabularies', () => {
    expect([...JULIUS_MEMORY_PROVENANCE]).toEqual([
      'user_stated', 'repository_observed', 'tool_observed', 'run_observed',
      'reviewer_verified', 'system_policy', 'derived_candidate', 'external_retrieved',
    ]);
    expect([...JULIUS_MEMORY_TRUST_STATES]).toEqual([
      'UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED', 'CONTRADICTED', 'SUPERSEDED',
    ]);
  });

  it('admits a candidate UNVERIFIED however much trust was requested', () => {
    // THE CENTRAL INVARIANT. Requesting more is not refused — refusing would
    // tempt callers to stop generating candidates, and generating them is meant
    // to be free. It is admitted at UNVERIFIED, which is what costs something.
    for (const requestedTrust of JULIUS_MEMORY_TRUST_STATES) {
      const claim = candidate({ claimId: `claim-${requestedTrust}`, requestedTrust });
      expect(claim.trust, `requesting ${requestedTrust} must not grant it`).toBe('UNVERIFIED');
    }
    expect(candidate().evidence).toHaveLength(0);
    expect(candidate().supersedes).toBeNull();
    expect([...candidate().contradicts]).toEqual([]);
  });

  it('refuses a claim nobody asserted, and says which field was missing', () => {
    expect(refusal(admitJuliusMemoryCandidate({
      claimId: 'c', entryId: 'e', provenance: 'run_observed', assertedBy: '  ', assertedAt: AT,
    }))).toBe('memory_asserter_required');
    expect(refusal(admitJuliusMemoryCandidate({
      claimId: '', entryId: 'e', provenance: 'run_observed', assertedBy: 'w', assertedAt: AT,
    }))).toBe('memory_claim_id_required');
    expect(refusal(admitJuliusMemoryCandidate({
      claimId: 'c', entryId: 'e', provenance: 'invented' as never, assertedBy: 'w', assertedAt: AT,
    }))).toBe('memory_provenance_unknown');
  });

  it('needs reviewer evidence from someone other than the asserter to reach VERIFIED', () => {
    const claim = candidate();
    // No evidence at all.
    refusal(promoteJuliusMemoryClaim(claim, { to: 'VERIFIED', by: REVIEWER, evidence: [], at: AT }));
    // Evidence of the wrong kind: a RUN is an observation, not a verdict.
    refusal(promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'RUN', id: 'run-1' }], at: AT,
    }), 'memory_evidence_insufficient_for_verified');
    // SELF-VERIFICATION. The asserter cannot be the authority for its own claim.
    refusal(promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: claim.assertedBy, evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
    }), 'memory_self_verification');
    // And the legitimate case.
    const verified = ok(promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
    }));
    expect(verified.trust).toBe('VERIFIED');
    expect(verified.evidence).toHaveLength(1);
    expect(verified.claimId, 'promotion does not mint a new claim').toBe(claim.claimId);
  });

  it('never promotes a contradicted or superseded claim again', () => {
    const [contradictedClaim] = ok(contradictJuliusMemoryClaims(
      candidate({ claimId: 'a' }), candidate({ claimId: 'b' }), AT));
    expect(contradictedClaim.trust).toBe('CONTRADICTED');
    refusal(promoteJuliusMemoryClaim(contradictedClaim, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
    }), 'memory_claim_terminal');

    const [superseded] = ok(supersedeJuliusMemoryClaim(
      candidate({ claimId: 'old' }), candidate({ claimId: 'next' }), AT));
    expect(superseded.trust).toBe('SUPERSEDED');
    refusal(promoteJuliusMemoryClaim(superseded, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
    }), 'memory_claim_terminal');
  });

  it('lets an APPROVED claim survive a contradiction that demotes the other', () => {
    // A human or policy authority outranks a conflicting assertion. Both are
    // still RECORDED as conflicting — the contradiction is a fact, not a deletion.
    const approved = ok(promoteJuliusMemoryClaim(candidate({ claimId: 'approved' }), {
      to: 'APPROVED', by: 'founder', evidence: [{ kind: 'DECISION', id: 'decision-1' }], at: AT,
    }));
    const [left, right] = ok(contradictJuliusMemoryClaims(approved, candidate({ claimId: 'guess' }), AT));
    expect(left.trust, 'an approved claim is not demoted by a bare assertion').toBe('APPROVED');
    expect(right.trust).toBe('CONTRADICTED');
    expect(left.contradicts, 'and the conflict is recorded on both').toContain('guess');
    expect(right.contradicts).toContain('approved');
  });

  it('links a replacement to what it replaced', () => {
    const old = candidate({ claimId: 'old' });
    const [wasOld, isNext] = ok(supersedeJuliusMemoryClaim(old, candidate({ claimId: 'next' }), AT));
    expect(wasOld.trust).toBe('SUPERSEDED');
    expect(isNext.supersedes).toBe('old');
    // A claim about a DIFFERENT entry is not a replacement for this one.
    refusal(supersedeJuliusMemoryClaim(old, candidate({ claimId: 'other', entryId: 'entry-2' }), AT),
      'memory_supersede_entry_mismatch');
    // Nor is a claim superseding itself.
    refusal(supersedeJuliusMemoryClaim(old, old, AT), 'memory_supersede_self');
  });

  it('never retrieves a contradicted or superseded claim, whatever it once was', () => {
    const verified = ok(promoteJuliusMemoryClaim(candidate({ claimId: 'good' }), {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
    }));
    const [dead] = ok(contradictJuliusMemoryClaims(verified, candidate({ claimId: 'rival' }), AT));
    const bare = candidate({ claimId: 'bare' });

    expect(retrieveTrustedJuliusMemory([verified, dead, bare], {
      minimumTrust: 'VERIFIED', role: 'CODING_AGENT',
    }).map((claim) => claim.claimId), 'only the standing that survives, at or above the bar').toEqual(['good']);

    expect(retrieveTrustedJuliusMemory([verified, bare], {
      minimumTrust: 'UNVERIFIED', role: 'CODING_AGENT',
    }).map((claim) => claim.claimId),
    'a lower bar admits more, and the ordering of the states is what decides').toEqual(['good', 'bare']);
  });

  it('refuses a promotion that does not raise standing', () => {
    // FOUND BY CHECKING THE SPECIFICATION AGAINST AN IMPLEMENTATION BEFORE
    // PAYING FOR ONE. Nothing else here forbids `promoteJuliusMemoryClaim` from
    // being a general "set the trust field", which would let an APPROVED claim
    // be quietly returned to UNVERIFIED — losing an adopted decision with no
    // record that anything was lost.
    const approved = ok(promoteJuliusMemoryClaim(candidate({ claimId: 'a' }), {
      to: 'APPROVED', by: 'founder', evidence: [{ kind: 'DECISION', id: 'd' }], at: AT,
    }));
    for (const to of ['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED'] as const) {
      refusal(promoteJuliusMemoryClaim(approved, {
        to, by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'r' }, { kind: 'DECISION', id: 'd' }], at: AT,
      }), 'memory_trust_not_a_promotion');
    }
    // Demotion is not what CONTRADICTED and SUPERSEDED are for either: those
    // are reached by contradiction and supersession, which record WHY.
    for (const to of ['CONTRADICTED', 'SUPERSEDED'] as const) {
      refusal(promoteJuliusMemoryClaim(candidate({ claimId: 'b' }), {
        to: to as never, by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
      }), 'memory_trust_not_a_promotion_target');
    }
  });

  it('mutates none of its inputs', () => {
    const claim = candidate();
    const before = JSON.stringify(claim);
    promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
    });
    contradictJuliusMemoryClaims(claim, candidate({ claimId: 'other' }), AT);
    supersedeJuliusMemoryClaim(claim, candidate({ claimId: 'later' }), LATER);
    expect(JSON.stringify(claim), 'a claim handed in comes back unchanged').toBe(before);
  });
});

// ────────────────────────────────── beyond the seeded specification
//
// The seed is a floor. Each case below holds an invariant the module's own prose
// states and the seed did not check — which is exactly the shape of defect the
// zero-spend qualification kept finding: a rule everyone believed was enforced
// because it was written down.

describe('the trust core, past its seeded floor', () => {
  it('holds its evidentiary ladder at every standing, not only at VERIFIED', () => {
    const claim = candidate();
    // SUPPORTED takes an observation — and a DECISION is an adoption, not one.
    refusal(promoteJuliusMemoryClaim(claim, {
      to: 'SUPPORTED', by: REVIEWER, evidence: [{ kind: 'DECISION', id: 'd' }], at: AT,
    }), 'memory_evidence_insufficient_for_supported');
    expect(ok(promoteJuliusMemoryClaim(claim, {
      to: 'SUPPORTED', by: 'executor', evidence: [{ kind: 'RUN', id: 'run-1' }], at: AT,
    })).trust).toBe('SUPPORTED');

    // APPROVED takes a DECISION — a review is a verdict, not an adoption.
    refusal(promoteJuliusMemoryClaim(claim, {
      to: 'APPROVED', by: 'founder', evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
    }), 'memory_evidence_insufficient_for_approved');
    expect(ok(promoteJuliusMemoryClaim(claim, {
      to: 'APPROVED', by: 'founder', evidence: [{ kind: 'DECISION', id: 'd' }], at: AT,
    })).trust, 'a founder decision may adopt an unverified candidate outright').toBe('APPROVED');
  });

  it('refuses self-verification at every standing, including adoption', () => {
    // The seed proved this only for VERIFIED. A compound agent that can approve
    // its own memory has no trust core at all.
    const claim = candidate();
    for (const to of ['SUPPORTED', 'VERIFIED', 'APPROVED'] as const) {
      refusal(promoteJuliusMemoryClaim(claim, {
        to, by: claim.assertedBy,
        evidence: [{ kind: 'REVIEW', id: 'r' }, { kind: 'DECISION', id: 'd' }, { kind: 'RUN', id: 'run' }],
        at: AT,
      }), 'memory_self_verification');
    }
  });

  it('keeps the evidence a promotion was granted on, added to what the claim held', () => {
    const supported = ok(promoteJuliusMemoryClaim(candidate(), {
      to: 'SUPPORTED', by: 'executor', evidence: [{ kind: 'RUN', id: 'run-1' }], at: AT,
    }));
    const verified = ok(promoteJuliusMemoryClaim(supported, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: LATER,
    }));
    expect(verified.evidence.map((reference) => reference.id),
      'the ladder a claim climbed is readable from the claim').toEqual(['run-1', 'review-1']);
    // `assertedAt` is when the claim was ASSERTED. A promotion is a different
    // event with its own durable row, and must not rewrite this one.
    expect(verified.assertedAt).toBe(AT);
  });

  it('refuses a transition it could not have recorded', () => {
    const claim = candidate();
    refusal(promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'REVIEW', id: 'r' }], at: 'soon',
    }), 'memory_timestamp_invalid');
    refusal(contradictJuliusMemoryClaims(claim, candidate({ claimId: 'other' }), ''),
      'memory_timestamp_invalid');
    refusal(admitJuliusMemoryCandidate({
      claimId: 'c', entryId: 'e', provenance: 'run_observed', assertedBy: 'w', assertedAt: 'yesterday',
    }), 'memory_timestamp_invalid');
    refusal(promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: '   ', evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
    }), 'memory_authority_required');
  });

  it('refuses an evidence reference that points at nothing', () => {
    refusal(admitJuliusMemoryCandidate({
      claimId: 'c', entryId: 'e', provenance: 'run_observed', assertedBy: 'w', assertedAt: AT,
      evidence: [{ kind: 'REVIEW', id: '' }],
    }), 'memory_evidence_reference_invalid');
    refusal(promoteJuliusMemoryClaim(candidate(), {
      to: 'VERIFIED', by: REVIEWER, evidence: [{ kind: 'RUBRIC' as never, id: 'r' }], at: AT,
    }), 'memory_evidence_reference_invalid');
  });

  it('records a contradiction once, however many times it is asserted', () => {
    const [first] = ok(contradictJuliusMemoryClaims(candidate({ claimId: 'a' }), candidate({ claimId: 'b' }), AT));
    const [again] = ok(contradictJuliusMemoryClaims(first, candidate({ claimId: 'b' }), LATER));
    expect([...again.contradicts], 'the lineage is a set, not a tally').toEqual(['b']);
    refusal(contradictJuliusMemoryClaims(first, first, AT), 'memory_claim_self_contradiction');
  });

  it('demotes both sides when nothing separates them', () => {
    // Two APPROVED claims that contradict: neither authority outranks the
    // other, so keeping either would be the silent pick the module forbids.
    const approve = (claimId: string) => ok(promoteJuliusMemoryClaim(candidate({ claimId }), {
      to: 'APPROVED', by: 'founder', evidence: [{ kind: 'DECISION', id: `d:${claimId}` }], at: AT,
    }));
    const [left, right] = ok(contradictJuliusMemoryClaims(approve('x'), approve('y'), AT));
    expect([left.trust, right.trust]).toEqual(['CONTRADICTED', 'CONTRADICTED']);
  });

  it('will not let supersession overwrite a recorded contradiction', () => {
    const [dead] = ok(contradictJuliusMemoryClaims(candidate({ claimId: 'a' }), candidate({ claimId: 'b' }), AT));
    refusal(supersedeJuliusMemoryClaim(dead, candidate({ claimId: 'c' }), LATER),
      'memory_supersede_contradicted');
    // And a dead replacement replaces nothing.
    refusal(supersedeJuliusMemoryClaim(candidate({ claimId: 'live' }), dead, LATER),
      'memory_supersede_replacement_terminal');
  });

  it('refuses a replacement already bound to a different predecessor', () => {
    const [, bound] = ok(supersedeJuliusMemoryClaim(
      candidate({ claimId: 'first' }), candidate({ claimId: 'second' }), AT));
    expect(bound.supersedes).toBe('first');
    refusal(supersedeJuliusMemoryClaim(candidate({ claimId: 'other' }), bound, LATER),
      'memory_supersede_replacement_bound');
    // Re-running the same supersession is idempotent rather than refused.
    expect(ok(supersedeJuliusMemoryClaim(candidate({ claimId: 'first' }), bound, LATER))[1].supersedes)
      .toBe('first');
  });

  it('returns nothing for a bar that is not a position on the ladder', () => {
    const claims = [candidate({ claimId: 'a' })];
    for (const minimumTrust of ['CONTRADICTED', 'SUPERSEDED'] as JuliusMemoryTrustState[]) {
      expect(retrieveTrustedJuliusMemory(claims, { minimumTrust, role: 'CODING_AGENT' }),
        `${minimumTrust} is not a lower bar that admits more`).toEqual([]);
    }
  });

  it('retrieves deterministically, and the role it is given cannot narrow the result', () => {
    // ROLE SCOPE IS NOT ENFORCED HERE AND THE TEST SAYS SO OUT LOUD. A claim
    // qualifies an ENTRY; the roles live on the entry, which this function is
    // never handed. `julius-context-integrity` is what enforces the scope, and
    // `julius-context-integrity.test.ts` is where that is proven.
    const claims = [
      candidate({ claimId: 'c' }), candidate({ claimId: 'a' }), candidate({ claimId: 'b' }),
    ];
    const ids = (role: 'CODING_AGENT' | 'INDEPENDENT_REVIEWER' | 'PROMPT_ARCHITECT') =>
      retrieveTrustedJuliusMemory(claims, { minimumTrust: 'UNVERIFIED', role }).map((claim) => claim.claimId);
    expect(ids('CODING_AGENT')).toEqual(['a', 'b', 'c']);
    expect(ids('INDEPENDENT_REVIEWER')).toEqual(['a', 'b', 'c']);
    expect(ids('PROMPT_ARCHITECT')).toEqual(['a', 'b', 'c']);
    // Shuffling the input cannot change the output.
    expect(retrieveTrustedJuliusMemory([...claims].reverse(), {
      minimumTrust: 'UNVERIFIED', role: 'CODING_AGENT',
    }).map((claim) => claim.claimId)).toEqual(['a', 'b', 'c']);
  });

  it('never leaves a caller holding a live reference into a returned claim', () => {
    const evidence = [{ kind: 'REVIEW' as const, id: 'review-1' }];
    const claim = ok(admitJuliusMemoryCandidate({
      claimId: 'c', entryId: 'e', provenance: 'reviewer_verified', assertedBy: 'w', assertedAt: AT, evidence,
    }));
    evidence.push({ kind: 'REVIEW' as const, id: 'smuggled' });
    expect(claim.evidence.map((reference) => reference.id),
      'a claim cannot grow evidence after it was admitted').toEqual(['review-1']);
  });
});
